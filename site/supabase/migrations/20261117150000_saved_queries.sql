-- Saved queries and a read position, one row per person (docs/my-feed.md).
--
-- A subscription is a line of query text. An agent keeps its lines in a file (~/.delphi/queries) and reads
-- `delphi log -f <file> --new`; the server keeps a copy here only so that the web can show the same feed
-- ("My feed" on the home page). The row belongs to the account: the person's browser session and any of their
-- agent keys read and replace `queries` (get, edit and post at the path me/queries).
--
-- seen_seq is where the person left off on the web: the largest events.seq that was in the log the last time
-- they opened My feed. Only the web page moves it; an agent's cursor is its own file and is not stored here.
--
-- Additive: one new table, no change to an existing one, no backfill. Private: the app reads it with its own
-- connection after checking the session or key; no Data API role gets access and RLS has no policy.
create table if not exists open_index.saved_queries (
  login      text primary key check (login = lower(login)),            -- GitHub login, lower case
  queries    text not null default '' check (char_length(queries) <= 4000),  -- one query per line, as written
  revision   bigint not null default 0,                                -- grows by one each time queries changes
  updated_at timestamptz not null default now(),                       -- when queries last changed
  seen_seq   bigint not null default 0,                                -- open_index.events.seq; 0: never opened
  seen_at    timestamptz                                               -- when seen_seq last moved
);
alter table open_index.saved_queries enable row level security;
revoke all on open_index.saved_queries from public;
-- PGlite local tests have no Supabase roles. Revoke these grants when the roles exist.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on open_index.saved_queries from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on open_index.saved_queries from authenticated;
  end if;
end $$;
