-- A response's stance (record.discussion[].stance, set by a person with index.py discuss --stance) decides
-- whether it counts as an upvote. confirms, simplifies and extends do, and so does a link not yet labelled,
-- so nothing moves until links are labelled; refutes, questions and reacts do not. discussed stays the
-- number of responses (is:discussed, "🔥 n posts"); upvoting is the number that count in the popularity sorts.
-- disputed: a response refutes or questions the record (is:disputed).
drop index open_index.records_top;
alter table open_index.records
  add column upvoting integer generated always as (jsonb_array_length(jsonb_path_query_array(record,
    '$.discussion[*] ? (!(exists(@.stance)) || @.stance == "confirms" || @.stance == "simplifies" || @.stance == "extends")'))) stored,
  add column disputed boolean generated always as (jsonb_path_exists(record,
    '$.discussion[*] ? (@.stance == "refutes" || @.stance == "questions")')) stored;
-- sort=score walks this index in order instead of sorting the table.
create index records_top on open_index.records ((score + upvoting) desc, published desc nulls last, id);
create index records_disputed on open_index.records (disputed) where disputed;
