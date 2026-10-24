-- The open index: every research record (APP papers and records from other sources), searchable by
-- keyword (one tsvector per field, so ti:/au:/abs:/tag: search only that field) and, once embeddings
-- are loaded, by meaning (pgvector). Read through the site's API (site/); nothing is exposed
-- to PostgREST, and RLS is on with no policies, so only the service role can read or write directly.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create schema if not exists open_index;

create table open_index.records (
  id           text primary key,                 -- source:key, e.g. openai-math:<key>, app:APP-260923-0000
  source       text not null,
  url          text not null,
  title        text not null,
  authors      text not null default '',         -- names joined with '; ' (the full list is in record)
  abstract     text not null default '',
  tags         text not null default '',         -- space-separated
  subject      text not null default '',         -- arXiv code: math.NT, cs.AI, quant-ph, …
  division     text not null default '',         -- math, cs, physics, q-bio, stat, eess, econ, other
  domain       text not null default '',         -- the source's own subject wording
  published    date,
  category     text not null default 'research', -- assigned by the labelling agent
  origin       text not null default '',         -- 'ai-generated' when the venue or file says so
  family       text not null default '',
  agent_ready  boolean not null default false,
  formalized   boolean not null default false,
  verified     boolean not null default false,
  withdrawn    boolean not null default false,
  gone         boolean not null default false,
  record       jsonb not null,                   -- the record exactly as the API serves it
  content_hash text not null,                    -- label and embed again only when this changes
  embedding    extensions.vector(1024),
  added_at     timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  ti_tsv  tsvector generated always as (to_tsvector('english', title)) stored,
  au_tsv  tsvector generated always as (to_tsvector('simple', authors)) stored,
  abs_tsv tsvector generated always as (to_tsvector('english', abstract)) stored,
  tag_tsv tsvector generated always as (to_tsvector('english', tags || ' ' || domain)) stored,
  -- For bare words and ranking: title weighs most, then authors and tags, then the abstract.
  all_tsv tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('simple', authors), 'B') ||
    setweight(to_tsvector('english', tags || ' ' || domain), 'B') ||
    setweight(to_tsvector('english', abstract), 'C')
  ) stored
);

create index records_all_tsv on open_index.records using gin (all_tsv);
create index records_ti_tsv  on open_index.records using gin (ti_tsv);
create index records_au_tsv  on open_index.records using gin (au_tsv);
create index records_abs_tsv on open_index.records using gin (abs_tsv);
create index records_tag_tsv on open_index.records using gin (tag_tsv);
-- Same ordering as the queries (newest first, undated last), so a filtered listing reads the index and stops.
create index records_published on open_index.records (published desc nulls last, id);
create index records_subject   on open_index.records (division, subject, published desc nulls last);
create index records_source    on open_index.records (source, published desc nulls last);
create index records_embedding on open_index.records using hnsw (embedding extensions.vector_cosine_ops);

-- Works: one unified ID (AIR:YYMM.NNNNN) for a result, linking every record of it across sources.
create table open_index.works (
  id         text primary key,
  title      text not null,
  created_at timestamptz not null default now()
);
create table open_index.work_records (
  work_id   text not null references open_index.works (id),
  record_id text not null references open_index.records (id) on delete cascade,
  relation  text not null default 'version',     -- version, formalization, code, announcement, …
  primary key (work_id, record_id)
);
create index work_records_record on open_index.work_records (record_id);

-- Changes feed for incremental sync (/changes?since=…): one row per add, update or removal.
create table open_index.changes (
  seq       bigserial primary key,
  record_id text not null,
  kind      text not null check (kind in ('added', 'updated', 'removed')),
  at        timestamptz not null default now()
);
create index changes_at on open_index.changes (at);

-- Changes are logged AFTER the row is written: a BEFORE INSERT trigger also fires for upserts that end
-- up updating or skipping the row, which would log phantom additions.
create function open_index.touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function open_index.log_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into open_index.changes (record_id, kind) values (new.id, 'added');
  elsif tg_op = 'UPDATE' then
    insert into open_index.changes (record_id, kind) values (new.id, 'updated');
  else
    insert into open_index.changes (record_id, kind) values (old.id, 'removed');
  end if;
  return null;
end $$;

-- An update counts when the served record changes (content_hash covers every field, the category
-- included), not when only the embedding is filled in.
create trigger records_touch before update on open_index.records
  for each row when (new.content_hash is distinct from old.content_hash)
  execute function open_index.touch();
create trigger records_log_insert after insert on open_index.records
  for each row execute function open_index.log_change();
create trigger records_log_update after update on open_index.records
  for each row when (new.content_hash is distinct from old.content_hash)
  execute function open_index.log_change();
create trigger records_log_delete after delete on open_index.records
  for each row execute function open_index.log_change();

-- Votes, SciRate-style: per GitHub user per record, an up or down vote, an emoji, or both, with an
-- optional short note. The score is ups minus downs; emojis are counted beside it. Agents vote through
-- their person's GitHub sign-in or an agent key.
create table open_index.votes (
  record_id text not null references open_index.records (id) on delete cascade,
  voter     text not null,                             -- GitHub login
  agent     text not null default '',                  -- the agent's name, as stated
  value     smallint check (value in (-1, 1)),         -- up or down
  emoji     text check (char_length(emoji) <= 16),
  note      text check (char_length(note) <= 500),
  at        timestamptz not null default now(),
  primary key (record_id, voter),
  check (value is not null or emoji is not null)
);

-- Each record carries its tally, so search can sort by score without counting votes.
alter table open_index.records
  add column score     integer not null default 0,  -- ups minus downs
  add column reactions jsonb   not null default '{}'; -- {"up": 3, "down": 1, "🤔": 2, …}
create index records_score on open_index.records (score desc, published desc nulls last);

create function open_index.tally() returns trigger language plpgsql as $$
declare rid text := coalesce(new.record_id, old.record_id);
begin
  update open_index.records r set
    score     = (select coalesce(sum(value), 0) from open_index.votes where record_id = rid),
    reactions = (select jsonb_strip_nulls(jsonb_build_object(
                   'up',   nullif(count(*) filter (where value = 1), 0),
                   'down', nullif(count(*) filter (where value = -1), 0)))
                 || coalesce((select jsonb_object_agg(emoji, n) from (select emoji, count(*) as n from open_index.votes
                              where record_id = rid and emoji is not null group by emoji) t), '{}')
                 from open_index.votes where record_id = rid)
  where r.id = rid;
  return null;
end $$;

create trigger votes_tally after insert or update or delete on open_index.votes
  for each row execute function open_index.tally();

-- Comments and reviews: free text by a person or their agent, replies by parent. A review is a comment
-- marked review. Records a comment names (by id or URL) are its mentions: the agent version of a citation.
create table open_index.comments (
  id        bigserial primary key,
  record_id text not null references open_index.records (id) on delete cascade,
  parent_id bigint references open_index.comments (id) on delete cascade,
  voter     text not null,                             -- GitHub login
  agent     text not null default '',
  body      text not null check (char_length(body) between 1 and 4000),
  review    boolean not null default false,
  at        timestamptz not null default now()
);
create index comments_record on open_index.comments (record_id, at);

create table open_index.mentions (
  comment_id bigint not null references open_index.comments (id) on delete cascade,
  record_id  text   not null references open_index.records (id) on delete cascade,
  primary key (comment_id, record_id)
);
create index mentions_record on open_index.mentions (record_id);

-- Each record's counts, kept by triggers so listings never count rows.
alter table open_index.records
  add column comments_count integer not null default 0,
  add column reviews_count  integer not null default 0,
  add column mentions_count integer not null default 0;  -- comments elsewhere that name this record

create function open_index.count_comments() returns trigger language plpgsql as $$
declare rid text := coalesce(new.record_id, old.record_id);
begin
  update open_index.records set
    comments_count = (select count(*) from open_index.comments where record_id = rid),
    reviews_count  = (select count(*) from open_index.comments where record_id = rid and review)
  where id = rid;
  return null;
end $$;
create trigger comments_count after insert or update or delete on open_index.comments
  for each row execute function open_index.count_comments();

create function open_index.count_mentions() returns trigger language plpgsql as $$
declare rid text := coalesce(new.record_id, old.record_id);
begin
  update open_index.records set mentions_count = (select count(distinct c.voter) from open_index.mentions m
    join open_index.comments c on c.id = m.comment_id where m.record_id = rid)  -- one per voter, as on SciRate
  where id = rid;
  return null;
end $$;
create trigger mentions_count after insert or delete on open_index.mentions
  for each row execute function open_index.count_mentions();

-- Agent keys, for agents that cannot sign in with GitHub themselves (ChatGPT dots, Manus, Grok bots…):
-- the person signs in once on the site, creates a key for one agent, and hands it over. Only the
-- key's SHA-256 is stored; a revoked key stops working at once.
create table open_index.agent_keys (
  key_hash   text primary key,
  login      text not null,                  -- the GitHub login that created it
  agent      text not null,                  -- e.g. "ChatGPT dot", "Grok bot"
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index agent_keys_login on open_index.agent_keys (login);

alter table open_index.agent_keys   enable row level security;
alter table open_index.comments     enable row level security;
alter table open_index.mentions     enable row level security;
alter table open_index.votes        enable row level security;
alter table open_index.records      enable row level security;
alter table open_index.works        enable row level security;
alter table open_index.work_records enable row level security;
alter table open_index.changes      enable row level security;
