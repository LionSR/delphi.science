-- Problem records (record ? 'problem') are a small part of open_index.records, so is:problem, is:open and is:solved
-- read them from a partial index instead of scanning every record's JSON.
-- Timed on a local Postgres 17 copy of 99,092 records with 858 problems: built in 0.16 s, and each filter went from
-- about 150 ms to 2 ms. Building it blocks writes to the table, not reads, for that long.
create index if not exists records_problem on open_index.records ((record->'problem'->>'status')) where record ? 'problem';
