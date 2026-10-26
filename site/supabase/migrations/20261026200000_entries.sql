-- The entries, one per record: what index.py harvests, labels, refreshes and annotates (discuss, reception), and
-- builds into open_index.records. The site's submissions are entries too (lib/submit.ts), so the daily pull labels
-- and refreshes them like the rest. They were files in git, entries/<source>/<key>.json; store.py reads and
-- writes them now.
create table open_index.entries (
  id         text primary key,                                    -- <source>/<key>, as records.id
  source     text not null generated always as (split_part(id, '/', 1)) stored,
  entry      jsonb not null,
  version    integer not null default 1,                          -- raised on every write: a save made from an
  updated_at timestamptz not null default now()                   -- older read is refused (store.py Conflict)
);
create index entries_source on open_index.entries (source);
-- A person adds at most 20 links a day, on the site or with index.py add: this counts them.
create index entries_added_by on open_index.entries ((entry->>'added_by'), (entry->>'added'));

-- Every earlier version of an entry, for audit and undo, as git history was. A refresh that moves only the
-- refreshed date is not kept, or each weekly pass would copy the whole index.
create table open_index.entry_history (
  seq      bigserial primary key,
  id       text not null,
  version  integer not null,
  entry    jsonb not null,
  replaced timestamptz not null default now(),
  deleted  boolean not null default false
);
create index entry_history_id on open_index.entry_history (id, seq);

create function open_index.keep_entry() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into open_index.entry_history (id, version, entry, deleted) values (old.id, old.version, old.entry, true);
    return old;
  end if;
  if (old.entry - 'refreshed') is distinct from (new.entry - 'refreshed') then
    insert into open_index.entry_history (id, version, entry) values (old.id, old.version, old.entry);
  end if;
  return new;
end $$;
create trigger entries_history before update or delete on open_index.entries
  for each row execute function open_index.keep_entry();

alter table open_index.entries       enable row level security;
alter table open_index.entry_history enable row level security;
