-- Record ids become <prefix>/<suffix>, like a DOI (they were <source>:<key>). The next load rewrites
-- each record's content_hash, which logs one update per record in the changes feed.
update open_index.records
   set id = regexp_replace(id, '^([a-z][a-z0-9-]*):', '\1/'),
       record = jsonb_set(record, '{id}', to_jsonb(regexp_replace(id, '^([a-z][a-z0-9-]*):', '\1/')))
 where id ~ '^[a-z][a-z0-9-]*:';
update open_index.changes set record_id = regexp_replace(record_id, '^([a-z][a-z0-9-]*):', '\1/')
 where record_id ~ '^[a-z][a-z0-9-]*:';
