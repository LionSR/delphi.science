# The log: one way to follow the site

`log` lists what happened on the site, in order. A feed is `log` with a query; an inbox is `log` with `to:@me`.
The server keeps no subscriptions: the reader decides what to read by the query it sends, and remembers one number.
(It does keep a copy of a person's queries, as text, so the website can show the same feed: [my-feed.md](my-feed.md).)

```
delphi log -q 'cat:quant-ph' --new        # new quant-ph records, and the posts about quant-ph records
delphi log -f ~/.delphi/queries --new     # a file of queries, one per line: what matches any
delphi log -q 'to:@me' --new              # replies to me, and posts in my topics
https://delphi.science/log.atom?q=cat:quant-ph      # the first, for a feed reader
```

## Events

`open_index.events` (migration `20261117130000_events.sql`) has one row for each record that enters the index and
one for each post. A row is a pointer: `seq`, `kind` (record, question, answer, comment, review), the record, topic
and post it refers to (and `path`, generated from them), `at`, and `voter` for a post. Titles and bodies stay in
their own tables and are joined when the log is read, so an edited post shows its current text and a deleted post or
record stops appearing. Rows are never updated or deleted.

Rows are written by two triggers, so every writer is covered (the build loader, a link submitted on the site, a post
by any door):

- `records_event`, `AFTER INSERT` on `open_index.records`. The loader upserts (`INSERT … ON CONFLICT (id) DO
  UPDATE`, `lib/records/load.ts`); for a record that is already there Postgres runs the update, and insert triggers
  do not fire. A rebuild or reload therefore writes no event. A unique index (`events_record_once`) covers the case
  that is left: a record deleted and later listed again keeps its first event.
- `comments_event`, `AFTER INSERT` on `open_index.comments`, with the post's kind fixed at that moment.

Both take one transaction-level advisory lock before taking a `seq`. Events therefore commit in `seq` order, and a
reader that remembers the largest `seq` it has seen cannot be passed by a smaller one committed later. A post and its
mentions are written in one transaction (`lib/posts/comments.ts`), so a reader never sees a post without them.

### What the migration does to rows that exist

- Each existing post gets the event whose `seq` is the post's id. Until now a post's `seq` in `log` was its id, so a
  `since` that a client holds means what it meant: the posts after it. New events continue after the largest id.
  From then on a `seq` is no longer a post's number; the number is the last part of the post's path.
- Each existing record gets an event with a `seq` below zero, the latest added nearest to zero. A `since` (zero or
  more) never returns them, so no client is sent the whole index; the newest-first listing, which a feed reader
  sees first, ends in them.

## The query

`q` in `log` is the record query language (`lib/records/query.ts`) with five fields added (`lib/posts/log.ts`):

| Term | Matches |
| --- | --- |
| `kind:record`, `kind:question`, `kind:answer`, `kind:comment`, `kind:review` | what happened |
| `re:<record id>` | posts on that record, or naming it |
| `to:@login` | posts by others that reply to that person's post, or are in a topic they started |
| `by:@login` | that person's posts |
| `section:methods` | questions, answers and comments in that public forum section |

`@me` is the caller and needs sign-in; everything else is public. A term about records (`cat:quant-ph`,
`source:arxiv`, `is:formalized`, a word) is true of a new-record event when the record fits it, and of a post when
the record it is on, or a record it names (`open_index.mentions`), fits it. Each term is decided on its own, so
`NOT cat:math` is a post none of whose records is in math. A bare word also matches a post's own text and its
topic's title. In public forum topics, `cat:` and its alias `domain:` also match a reply when a record named in the
opening question fits. A link in an answer applies to that answer alone. The log line's `mentions` still lists
only the records named in that post. For example, `section:methods cat:quant-ph` follows the matching discussions
across questions and replies. The same query works as a saved line. See [forum-sections.md](forum-sections.md).

Under a record's own path the log is the record's thread: its posts. The event for the record itself appears under
its source's path and in the whole log.

## The three doors, and two more for people

The operation is defined once (`log` in `lib/api/openapi.ts`). `GET /api/v1/log`, the MCP tool `log` and
`delphi log` take the same `path`, `q`, `since` and `limit` and return the same entries; signing in is optional and
only `@me` uses it. A line is tab-separated: seq, kind, path, parent, author, time, score, subject, text, mentions.
New columns are only added at the end.

The migration also adds the six verbs and `GET /txt/{id}` to the usage counts' endpoint list (`api_usage`), which
is a database constraint; `/log.atom` is counted as `GET /api/v1/log`.

- `format=atom`, or `/log.atom` with the same `path` and `q`, is the same entries as an Atom feed, always read as
  nobody. Pages link to theirs.
- A record page, a forum topic and a post have a text form at the page's address with `.txt` added
  (`lib/api/text.ts`): what `delphi get` prints, and for a thread one log line per post and then each post.

## Reading events in one place

Every read of `open_index.events` is `log()` in `lib/posts/log.ts`, and `visible()` there is the one condition on who
may see an event. It is the visibility rule of private spaces (`lib/posts/visibility.ts`, `open_index.can_read`): a
record and a post on a record are public; a post in a topic is seen by whoever can read the topic's space, which for
the forum is everyone and for a private space its accepted members. `log()` takes the reader as its second argument
(`null` for nobody), so no caller can leave it out. The feed and the text forms pass `null` whatever token came with
the request, so a private space has no feed and no text form. The MCP server reads the same way (`publicOnly`) while
spaces are closed to it (`privateOverMcp` in `lib/posts/spaces.ts`), with `@me` in a query still naming the caller.

A post in a private space still gets its row in `events` (the trigger does not know about spaces): a pointer with a
seq, read only through `log()`. Its `path` column says `forum/<topic>/<post>` for every topic, so `log()` builds the
path from the topic's space instead (`ws/<slug>/<topic>/<post>`). An invitation to a space and its acceptance are not
rows of `events`; they are two seqs on the member's row (`open_index.space_members.invited_seq`, `accepted_seq`),
drawn from the events sequence under the same ordering lock, and `log()` merges them in: the person invited reads
the invitation, the space's members read both. They are left out when the log is narrowed by a query,
with one exception: when the whole query is `to:@login` (or `to:@me`), an invitation sent to that person and the
acceptance of one they sent are included, so the inbox holds invitations. A `to:` inside a larger query is decided
over posts only.

## To check on a production-sized copy

PGlite says nothing about plans at size. Before applying the migration in production, run `EXPLAIN (ANALYZE,
BUFFERS)` on a copy for:

1. The unfiltered log, both directions (`ORDER BY seq DESC LIMIT 50`; `seq > $1 ORDER BY seq LIMIT 200`): expect
   the primary key, and nested-loop joins to comments, topics and records by their keys.
2. Posts only (`NOT kind:record`, `kind:comment`, `to:`, `by:`, `re:`): expect `events_posts`
   (partial, `post_id is not null`), so that the few posts are not found by walking past every record event.
3. `to:@login` and `by:@login` newest first for a person with few posts: expect `events_voter` for `by:`; `to:`
   walks `events_posts` and looks up each post's parent and topic, which is fine while posts are few and is the
   first to need a denormalised recipient column if they are not.
4. A selective record term newest first (`cat:quant-ph`, `ti:"zero-free"`, `source:openai-math`): the plan walks
   events backwards and checks each record by primary key until the page is full. A rare term can walk most of the
   table. If that is slow, the fix is to drive from `records` (its GIN and subject indexes) and join to events on
   `events_record_once`, or to cap how far back an unanchored query looks.
5. A source path (`path=arxiv`): `split_part(e.record_id, '/', 1) = $1` is a filter, not an index condition; cheap
   for a large source, slow for a small one. An index on that expression would fix it.
6. `re:<id>` without a path: `events_posts`, then `mentions` by `(comment_id, record_id)`; `e.record_id = $1` alone
   would use `events_record`.
7. The backfill itself: one sequential read of `open_index.records` (ids and `added_at`) and of
   `open_index.comments`, one row written per row read, and six index builds on the new table. It takes no lock that
   blocks readers or writers of the existing tables, but the insert triggers exist from the same transaction on.
