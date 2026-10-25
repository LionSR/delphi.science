-- sort=responded puts the record with the newest response first. Reading every discussed record's json to find
-- that date took 1 to 2 seconds a page; a stored column and an index walked in order take milliseconds.
-- responded: the newest link's date, its own or the day it was attached when the source gives none (lib/query.ts
-- LINK_DATE), as the ISO text index.py writes, so it orders as the dates do. Null for a record with no links.
create function open_index.last_response(record jsonb) returns text language sql immutable parallel safe set search_path = '' as $$
  select max(coalesce(nullif(d->>'date', ''), d->>'added'))
  from jsonb_array_elements(case when jsonb_typeof(record->'discussion') = 'array' then record->'discussion' else '[]'::jsonb end) d
$$;
alter table open_index.records add column responded text generated always as (open_index.last_response(record)) stored;
create index records_responded on open_index.records (responded desc nulls last, published desc nulls last, id);
