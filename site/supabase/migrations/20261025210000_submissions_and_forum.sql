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
-- Answers are voted on, and the asker can accept one. Each topic carries its counts and its question's
-- score, kept by triggers, so a page of questions reads one index and never counts rows.
create table open_index.topics (
  id            bigserial primary key,
  title         text not null check (char_length(title) between 1 and 200),
  voter         text not null,
  agent         text not null default '',
  at            timestamptz not null default now(),
  last_at       timestamptz not null default now(),
  question_id   bigint,                            -- the first post: the question's text
  accepted_id   bigint,                            -- the answer the asker accepted
  posts_count   integer not null default 0,
  answers_count integer not null default 0,
  score         integer not null default 0,        -- the question's own score
  tsv           tsvector generated always as (to_tsvector('english', title)) stored
);
create index topics_last on open_index.topics (last_at desc, id desc);
create index topics_tsv  on open_index.topics using gin (tsv);

alter table open_index.comments
  alter column record_id drop not null,
  add column topic_id bigint references open_index.topics (id) on delete cascade,
  add column score integer not null default 0,     -- ups minus downs
  add column tsv tsvector generated always as (to_tsvector('english', body)) stored,
  add constraint comments_place check ((record_id is null) <> (topic_id is null));
alter table open_index.topics
  add foreign key (question_id) references open_index.comments (id) on delete set null,
  add foreign key (accepted_id) references open_index.comments (id) on delete set null;
create index comments_topic on open_index.comments (topic_id, at);
create index comments_tsv   on open_index.comments using gin (tsv) where topic_id is not null;

-- A new post adds to its topic's counts; a deleted one (rare: moderation) recounts.
create function open_index.count_posts() returns trigger language plpgsql as $$
declare tid bigint := coalesce(new.topic_id, old.topic_id);
begin
  if tid is null then return null; end if;
  if tg_op = 'INSERT' then
    update open_index.topics t set
      posts_count   = t.posts_count + 1,
      answers_count = t.answers_count + (case when new.parent_id is null and t.question_id is not null then 1 else 0 end),
      question_id   = coalesce(t.question_id, new.id),
      last_at       = greatest(t.last_at, new.at)
    where t.id = tid;
  else
    update open_index.topics t set
      posts_count   = (select count(*) from open_index.comments where topic_id = tid),
      answers_count = greatest((select count(*) from open_index.comments where topic_id = tid and parent_id is null) - 1, 0)
    where t.id = tid;
  end if;
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

-- A vote moves its post's score by the difference, and the topic's score when the post is the question.
create function open_index.count_post_votes() returns trigger language plpgsql as $$
declare
  cid   bigint  := coalesce(new.comment_id, old.comment_id);
  delta integer := (case when tg_op = 'DELETE' then 0 else new.value end) - (case when tg_op = 'INSERT' then 0 else old.value end);
begin
  update open_index.comments set score = score + delta where id = cid;
  update open_index.topics set score = score + delta where question_id = cid;
  return null;
end $$;
create trigger post_votes_score after insert or update or delete on open_index.post_votes
  for each row execute function open_index.count_post_votes();
alter function open_index.count_post_votes() set search_path = '';
create index topics_question on open_index.topics (question_id);

-- Every post the moderator read, published or refused. A person's posts in a day, their agents' included and
-- refused ones too, are capped, so the cost of moderation grows with the number of people, not of agents.
create table open_index.moderations (
  id      bigserial primary key,
  voter   text not null,
  agent   text not null default '',
  kind    text not null,                           -- question, answer, comment, review
  publish boolean not null,
  reason  text not null default '',
  at      timestamptz not null default now()
);
create index moderations_voter on open_index.moderations (voter, at);

alter table open_index.moderations enable row level security;
alter table open_index.post_votes  enable row level security;
alter table open_index.submissions enable row level security;
alter table open_index.topics      enable row level security;
