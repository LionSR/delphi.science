-- Posts and articles about a record (record.discussion, see index.py discuss) count in the popularity
-- sorts. A stored count keeps those sorts off the jsonb: almost every record has none, and reading the
-- json of 85,000 rows to learn that took a second per page.
alter table open_index.records
  add column discussed integer generated always as
    (case when jsonb_typeof(record->'discussion') = 'array' then jsonb_array_length(record->'discussion') else 0 end) stored;
create index records_discussed on open_index.records (discussed) where discussed > 0;
-- sort=score walks this index in order instead of sorting the table.
create index records_top on open_index.records ((score + discussed) desc, published desc nulls last, id);
