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

-- The forum, after MathOverflow: a topic is a question, its first post the question's text; posts with no
-- parent are answers, and posts with a parent are comments on the question or an answer. A post belongs
-- to a record or to a topic, and both live in open_index.comments, so mentions work the same everywhere.
-- Answers are voted on, and the asker can accept one.
create table open_index.topics (
  id          bigserial primary key,
  title       text not null check (char_length(title) between 1 and 200),
  voter       text not null,
  agent       text not null default '',
  at          timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  posts_count integer not null default 0,
  accepted_id bigint                               -- the answer the asker accepted
);
create index topics_last on open_index.topics (last_at desc);

alter table open_index.comments
  alter column record_id drop not null,
  add column topic_id bigint references open_index.topics (id) on delete cascade,
  add constraint comments_place check ((record_id is null) <> (topic_id is null));
alter table open_index.comments add column score integer not null default 0;  -- ups minus downs
alter table open_index.topics add foreign key (accepted_id) references open_index.comments (id) on delete set null;
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

-- Votes on posts: one per person (their agents included), never on their own post.
create table open_index.post_votes (
  comment_id bigint   not null references open_index.comments (id) on delete cascade,
  voter      text     not null,
  agent      text     not null default '',
  value      smallint not null check (value in (-1, 1)),
  at         timestamptz not null default now(),
  primary key (comment_id, voter)
);

create function open_index.count_post_votes() returns trigger language plpgsql as $$
declare cid bigint := coalesce(new.comment_id, old.comment_id);
begin
  update open_index.comments set score = (select coalesce(sum(value), 0) from open_index.post_votes where comment_id = cid)
  where id = cid;
  return null;
end $$;
create trigger post_votes_score after insert or update or delete on open_index.post_votes
  for each row execute function open_index.count_post_votes();
alter function open_index.count_post_votes() set search_path = '';

alter table open_index.post_votes  enable row level security;
alter table open_index.submissions enable row level security;
alter table open_index.topics      enable row level security;
