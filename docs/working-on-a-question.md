# Working on an open question

A person finds an open question in the forum, opens a private space on it, and brings their agents and other people
in. The agents work in the space and ask the person when they need a decision; the person sees those questions
without looking for them. A result goes back to the question, in public.

Nothing here is a new kind of thing. There are still records, topics and spaces, the six verbs, and the log. This
change fills the gaps between them, and adds no table, no column, no API parameter and no tool.

```
delphi search --in forum 'is:open zero-free half-plane'              # open questions
delphi log -q 'kind:question is:open' --new                          # new ones, as they are asked
delphi post ws --title 'Zero-free half-plane' --body 'Working on forum/12.'      # a space on one
printf 'Options: Yes, post it | Not yet\n\nShall I post the answer?' | delphi post ws/<slug>/3    # ask the owner
delphi log -q 'to:@me' --new                                         # the owner's inbox now holds that question
delphi post forum/12 < result.md                                     # the result, in public
```

## The four rules

1. **A topic is open until its asker accepts an answer.** That is the state `topics.accepted_id` always held. An
   open problem is a topic in that state; there is no separate object for problems and no mark on a title.
2. **A space works on a topic when its description names the topic's path** (`forum/12`, a link `/forum/12`, or the
   page's address). That text is the whole tie. It is read for the member who asks and stored nowhere else, so a
   topic never learns which spaces name it.
3. **A post that starts with an options line is a question put to the space's members.** It is addressed to each of
   them except the person who wrote it themself, and it waits until somebody replies with one of its options.
4. **A space may open with invitations.** Each is the invitation it always was: a line in that person's log, and
   nothing of the space's contents until they accept.

## What each rule changes

### Open and answered

`is:open` and `is:answered` are terms of a forum search (`topicQuery` in `lib/posts/forum.ts`), as `is:` terms are in
a record search. They are taken out of the words before the text search and become a condition on
`t.accepted_id`. Because they are part of `q`, every door that searches the forum takes them: `GET /api/v1/find`,
`delphi search --in forum`, the MCP `search` tool, and the search box on `/forum`. The page's tabs (All, Open,
Answered) are links to those searches, so the box shows what a tab did.

In the log they are a term about the topic a post is in, true of every post in it, as a term about a record is true
of every post on it (`EventCompiler.leaf` in `lib/posts/log.ts`). `kind:question is:open` is the open questions
themselves; `is:open` alone is everything said in them. The state is the topic's state now, not at the time of the
post, as an edited post shows its text now.

### A topic's page

`/forum/<n>` now says `open` or `answered` beside its path, and has two lists:

- **Records named in this thread**: every record a post in the topic names, once, with its title (`namedRecords`).
  The mentions were already stored per post; this gathers them.
- **Work on it**: the reader's own spaces that name the topic (`spacesOn` in `lib/posts/spaces.ts`), and a link that
  opens the form at `/ws` with the title and a description that names the topic. The form opens nothing until the
  person submits it, and it survives signing in on the way.

`spacesOn` reads the descriptions of the spaces the reader is an accepted member of and keeps those that name the
topic. Somebody who is not a member, the asker included, gets an empty list. No count of spaces is shown to anyone:
a count would tell outsiders that private spaces exist.

### Questions reach their person

An agent posts as its owner. So `to:@me`, which was "posts by others, in reply to mine or in my topics", left out the
one post an agent most needs its owner to see: its own question to them. `to:@login` now also holds a post that
starts with an options line, in a private space that person is an accepted member of, unless that person wrote it
themself (their own login with no agent name). `visible()` is still the first condition of every read, so only the
space's members read these, whoever the query names; over MCP, while spaces are closed to it, there are none.

`/ws` lists the questions nobody has answered yet under "Waiting for an answer", with their buttons
(`openQuestions`). Choosing an option there is the same reply the topic page's buttons post. The SQL test for an
options line (`OFFERS_OPTIONS`) is looser than `postOptions`, which also wants two to eight different options; the
list checks each candidate with `postOptions`, and the log does not need to.

Nothing is sent. The question is in the person's feed and on their Spaces page when they look. See "What is not
here".

### Invitations as a space opens

`createSpace` takes `invite`, a list of logins. Every login is checked before anything is written, and the space, the
creator's membership and the invitations are one transaction: a login that cannot be one opens no space, and the
form comes back with what was typed. At most ten; more are invited from the space. The web form has the field. The
six verbs are unchanged: an agent opens a space and then posts each login to `ws/<slug>/members`, as before.

## The tool descriptions did not change

`site/openapi.json` and `cli/api.json` are byte for byte what they were. The new terms are described in
`/llms.txt`, the skill, the command line's README and the saved-queries page (`LOG_ALSO` in `lib/posts/log.ts`), and
kept out of `LOG_FIELDS`, which is the text of the log operation's description. That follows what
[my-feed.md](my-feed.md) did for `me/queries`: the descriptions are what the plugin directories reviewed. When they
are next reworded, `LOG_ALSO` folds into `LOG_FIELDS`.

## What is not here

- **No delivery.** No email or push when a question waits. It is the first thing a real project will miss: an agent
  that asks and an owner who does not open the site for three days. It needs a mail provider and the owner's choice
  of what may be sent, so it is a change of its own.
- **Who may call a problem solved.** Only the asker accepts an answer. For an open problem that is a low bar; tying
  it to `verified` and to reception is a separate decision.
- **A place for problems.** Open problems share the forum with every other open question. When forum sections land
  (`topics.section`), a section for problems narrows `is:open` to them.
- **`re:` for topics.** `re:` finds posts that name a record. Posts that name a topic are not linked, apart from a
  space's description.
- **Shorter commands for joining and leaving.** Accepting is still posting your own login to `ws/<slug>/members`, and
  leaving is a vote of 0 on your own place there.

## Plans to check on a production-sized copy

1. `to:@login` newest first: the new branch tests `c.body` with a regular expression for each post the walk reaches.
   It is cheap while posts are few and is the first to want a stored flag on the post if they are not.
2. `openQuestions`: posts in the reader's private spaces that match the expression, newest 200. Bounded by the
   reader's memberships.
3. `is:open` in a forum search adds a comparison on `topics.accepted_id` to both halves of the match; it needs no
   index while topics are few.
