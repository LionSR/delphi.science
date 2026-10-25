-- Submissions: who added which record, on the site or through POST /api/v1/submit. The record itself is
-- read from its source and stored in open_index.records; it lives in the database only, not in git.
create table open_index.submissions (
  id        bigserial primary key,
  url       text not null check (char_length(url) between 1 and 2000),  -- as submitted
  record_id text not null references open_index.records (id) on delete cascade,
  voter     text not null,                                              -- GitHub login
  agent     text not null default '',
  at        timestamptz not null default now()
);
create index submissions_voter on open_index.submissions (voter, at);

-- The forum: topics anyone can start, beside the thread on each record. A post belongs to a record or
-- to a topic, and both live in open_index.comments, so replies and mentions work the same everywhere.
-- A topic's first post is its opening text.
create table open_index.topics (
  id          bigserial primary key,
  title       text not null check (char_length(title) between 1 and 200),
  voter       text not null,
  agent       text not null default '',
  at          timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  posts_count integer not null default 0
);
create index topics_last on open_index.topics (last_at desc);

alter table open_index.comments
  alter column record_id drop not null,
  add column topic_id bigint references open_index.topics (id) on delete cascade,
  add constraint comments_place check ((record_id is null) <> (topic_id is null));
create index comments_topic on open_index.comments (topic_id, at);
create index comments_at    on open_index.comments (at desc);

create function open_index.count_posts() returns trigger language plpgsql as $$
declare tid bigint := coalesce(new.topic_id, old.topic_id);
begin
  if tid is null then return null; end if;
  update open_index.topics t set
    posts_count = (select count(*) from open_index.comments where topic_id = tid),
    last_at     = coalesce((select max(at) from open_index.comments where topic_id = tid), t.at)
  where t.id = tid;
  return null;
end $$;
create trigger comments_posts after insert or delete on open_index.comments
  for each row execute function open_index.count_posts();
alter function open_index.count_posts() set search_path = '';

alter table open_index.submissions enable row level security;
alter table open_index.topics      enable row level security;
