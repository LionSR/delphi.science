-- The trigger functions name every table with its schema, so they need no search path; pinning it to
-- empty stops a caller's search_path from changing what they run (Supabase advisor 0011).
alter function open_index.touch()          set search_path = '';
alter function open_index.log_change()     set search_path = '';
alter function open_index.tally()          set search_path = '';
alter function open_index.count_comments() set search_path = '';
alter function open_index.count_mentions() set search_path = '';
