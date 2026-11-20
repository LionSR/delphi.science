-- Events: one row each time a record first enters the index and each time a post is made, in one sequence, so
-- that "what happened on the site since seq N" is one read (lib/posts/log.ts). A row only points: at a record, or
-- at a post and the record or topic it is in. Titles and bodies are read from their own tables when the log is
-- shown, so an edit shows and a deleted post or record simply stops appearing. Rows are never updated or deleted.
--
-- Additive: one new table, two triggers, and a backfill that reads open_index.comments and open_index.records once
-- (ACCESS SHARE; it neither rewrites nor blocks them) and writes one row here for each.
create table open_index.events (
  seq       bigserial primary key,
  kind      text not null check (kind in ('record', 'question', 'answer', 'comment', 'review')),
  record_id text,                                  -- the record: itself for kind record, else the one the post is on
  topic_id  bigint,                                -- the forum topic the post is in
  post_id   bigint,                                -- the post (open_index.comments.id)
  -- The path the event refers to, as the tools take it: arxiv/2610.20058, arxiv/2610.20058/481, forum/12/502.
  path      text generated always as (case when post_id is null then record_id
              else coalesce(record_id, 'forum/' || topic_id::text) || '/' || post_id::text end) stored,
  at        timestamptz not null default now(),
  voter     text not null default '',              -- who posted; empty for a record
  check ((kind = 'record') = (post_id is null)),
  check ((record_id is null) <> (topic_id is null))
);
-- One event per record and per post, whatever writes the row and however often.
create unique index events_record_once on open_index.events (record_id) where kind = 'record';
create unique index events_post_once   on open_index.events (post_id) where post_id is not null;
-- A thread's events in order, posts alone in order (they are few among the records), and one person's posts.
create index events_record on open_index.events (record_id, seq);
create index events_topic  on open_index.events (topic_id, seq) where topic_id is not null;
create index events_posts  on open_index.events (seq) where post_id is not null;
create index events_voter  on open_index.events (lower(voter), seq) where post_id is not null;
alter table open_index.events enable row level security;

-- Writers take one transaction-level lock before taking a seq, so events commit in seq order and a reader
-- that remembers the largest seq it saw can never be passed by a smaller one that commits later.
create function open_index.event_order() returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(7262100117130000);
$$;

-- AFTER INSERT fires only for rows that were really inserted: an upsert that updates an existing record
-- (lib/records/load.ts, every rebuild and reload) fires the update triggers instead and writes nothing here.
-- The unique index covers what is left: a record removed and listed again keeps its first event.
create function open_index.log_record_event() returns trigger language plpgsql set search_path = '' as $$
begin
  perform open_index.event_order();
  insert into open_index.events (kind, record_id) values ('record', new.id)
  on conflict (record_id) where kind = 'record' do nothing;
  return null;
end $$;
create trigger records_event after insert on open_index.records
  for each row execute function open_index.log_record_event();

-- A post's kind is fixed when it is made: on a record a review or a comment; in a topic a comment when it
-- replies to a post, the question when it is the topic's first post, otherwise an answer.
create function open_index.log_post_event() returns trigger language plpgsql set search_path = '' as $$
declare k text;
begin
  if new.record_id is not null then k := case when new.review then 'review' else 'comment' end;
  elsif new.parent_id is not null then k := 'comment';
  elsif exists (select 1 from open_index.topics t where t.id = new.topic_id and t.question_id is not null and t.question_id <> new.id) then k := 'answer';
  else k := 'question';
  end if;
  perform open_index.event_order();
  insert into open_index.events (kind, record_id, topic_id, post_id, at, voter)
  values (k, new.record_id, new.topic_id, new.id, new.at, new.voter)
  on conflict (post_id) where post_id is not null do nothing;
  return null;
end $$;
create trigger comments_event after insert on open_index.comments
  for each row execute function open_index.log_post_event();

-- The posts already made keep their numbers: until now a post's seq was its id, and clients hold those as
-- "since". Each existing post gets the event whose seq is its id, and new events continue after the largest.
insert into open_index.events (seq, kind, record_id, topic_id, post_id, at, voter)
select c.id,
       case when c.record_id is not null then case when c.review then 'review' else 'comment' end
            when c.parent_id is not null then 'comment'
            when c.id = t.question_id then 'question' else 'answer' end,
       c.record_id, c.topic_id, c.id, c.at, c.voter
from open_index.comments c left join open_index.topics t on t.id = c.topic_id;

-- The records already indexed came before the log: they get the seqs below zero, the latest added nearest to
-- it. A since held by a client (zero or more) never returns them, and the newest-first listing, which a feed
-- reader sees, still ends in them.
insert into open_index.events (seq, kind, record_id, at)
select -row_number() over (order by r.added_at desc, r.published desc nulls last, r.id), 'record', r.id, r.added_at
from open_index.records r;

select setval(pg_get_serial_sequence('open_index.events', 'seq'),
              greatest((select max(seq) from open_index.events), 1),
              (select coalesce(max(seq), 0) from open_index.events) > 0);

-- Usage counts (open_index.api_usage) take the six verbs over paths and the text form of a page: the endpoint list
-- is this constraint, so counting a route means naming it here. /log.atom is counted as GET /api/v1/log, which it
-- is. NOT VALID, as before: existing rows are not read again, and they already fit the longer list.
ALTER TABLE open_index.api_usage
 DROP CONSTRAINT api_usage_endpoint_category,
 ADD CONSTRAINT api_usage_endpoint_category CHECK (endpoint IN ('GET /api/v1/search', 'GET /api/v1/records/{prefix}/{suffix}', 'GET /api/v1/records/{prefix}/{suffix}/comments', 'POST /api/v1/records/{prefix}/{suffix}/comments', 'GET /api/v1/records/{prefix}/{suffix}/vote', 'POST /api/v1/records/{prefix}/{suffix}/vote', 'DELETE /api/v1/records/{prefix}/{suffix}/vote', 'POST /api/v1/submit', 'GET /api/v1/forum', 'POST /api/v1/forum', 'GET /api/v1/forum/{id}', 'POST /api/v1/forum/{id}', 'POST /api/v1/forum/{id}/vote', 'POST /api/v1/forum/{id}/accept', 'GET /api/v1/prefixes', 'GET /api/v1/stats', 'POST /api/v1/keys/device', 'POST /api/v1/keys/token', 'GET /api/v1', 'GET /api/v1/openapi.json', 'GET /llms.txt', 'POST /mcp', 'GET /id/{prefix}/{suffix}', 'GET /sitemap.xml', 'GET /sitemap/{file}', 'GET /api/v1/users/{login}', 'GET /api/v1/profile', 'PATCH /api/v1/profile', 'GET /api/v1/keys', 'DELETE /api/v1/keys/{hash}', 'GET /api/v1/find', 'GET /api/v1/get/{id}', 'GET /api/v1/log', 'POST /api/v1/post/{id}', 'PATCH /api/v1/edit/{id}', 'POST /api/v1/vote/{id}', 'GET /txt/{id}')) NOT VALID;
