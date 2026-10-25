-- sort=mentions ("Most cited in comments") ranks only the records that comments name by id, almost none, and
-- fills the rest of the page from records_published (lib/query.ts). This finds them without reading the table;
-- ordering all 85,000 rows by mentions_count took 1 to 9 seconds a page.
create index records_mentioned on open_index.records (mentions_count) where mentions_count > 0;
