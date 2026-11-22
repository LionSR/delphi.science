-- Claims from the peer-to-peer network (client/), as a bridge hands them over (lib/p2p/claims.ts).
--
-- A claim is a signed statement by one key: a version of a research artifact was published (publish), a client
-- holds its files (have), a client re-ran the Lean checker on it (check), or where a client is reached
-- (endpoint). The network holds the signed originals. This table is a copy for the record pages, and it can be
-- rebuilt from the log of any client: nothing here is the source of truth.
--
-- The site does not verify signatures. It trusts the bridge that sent a claim, and a bridge is a delphi-p2p
-- client that verified each claim when it arrived.
--
-- Additive: two new tables, no change to an existing one, no backfill. Private: the app reads them with its own
-- connection; no Data API role gets access and RLS has no policy.
create table if not exists open_index.claims (
  id            text primary key check (id ~ '^[0-9a-f]{64}$'),   -- the hash of the signed operation
  author        text not null check (author ~ '^[0-9a-f]{64}$'),  -- the public key that signed it
  at_micros     bigint not null check (at_micros >= 0),           -- when the author signed it, microseconds since 1970 UTC
  kind          text not null check (char_length(kind) between 1 and 40),
  agent         text,                                             -- the agent that wrote it for its owner, as the claim says
  refs          text[] not null default '{}',                     -- ids of the claims it refers to
  data          jsonb not null,                                   -- the fields of its kind, as signed
  snapshot      text,                                             -- data.snapshot, for publish, have and check
  record_id     text,                                             -- for publish: the record its source names, listed or not
  received_at   timestamptz not null default now(),
  received_from text not null                                     -- GitHub login of the bridge's key
);
-- A record page: the versions that name the record, what follows them, and their checks.
create index if not exists claims_record on open_index.claims (record_id) where record_id is not null;
create index if not exists claims_refs on open_index.claims using gin (refs);
-- Who holds a snapshot.
create index if not exists claims_snapshot on open_index.claims (snapshot, kind) where snapshot is not null;

-- The versions whose file list the site still asks its bridge for: those it received in the last week.
create index if not exists claims_publish_received on open_index.claims (received_at desc) where kind = 'publish';

-- The file list of a snapshot: each file's path, size and hash, as a bridge's client read it from the snapshot.
-- It is not a claim. A publish claim signs the snapshot's hash, and that hash fixes the list, so the list needs
-- no signature of its own. The files themselves are never here.
create table if not exists open_index.snapshots (
  hash          text primary key check (hash ~ '^[0-9a-f]{64}$'),  -- the snapshot a publish claim names
  files         jsonb not null,                                    -- [{path, bytes, hash}]
  received_at   timestamptz not null default now(),
  received_from text not null                                      -- GitHub login of the bridge's key
);

alter table open_index.claims enable row level security;
alter table open_index.snapshots enable row level security;
revoke all on open_index.claims, open_index.snapshots from public;
-- PGlite local tests have no Supabase roles. Revoke these grants when the roles exist.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on open_index.claims, open_index.snapshots from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on open_index.claims, open_index.snapshots from authenticated;
  end if;
end $$;
