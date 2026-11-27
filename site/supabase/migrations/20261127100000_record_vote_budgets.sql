-- Opt-in account budgets for new record upvotes; configuration and counters are server-only.
-- Start a new policy on a future local date: historical votes lack immutable creation history.
create table open_index.record_vote_budgets (
  voter text primary key check (voter = lower(voter)),
  daily_limit integer not null check (daily_limit > 0),
  timezone text not null,
  starts_on date not null
);

create table open_index.record_vote_usage (
  voter text not null references open_index.record_vote_budgets(voter),
  local_day date not null,
  used integer not null check (used > 0),
  primary key (voter, local_day)
);

alter table open_index.record_vote_budgets enable row level security;
alter table open_index.record_vote_usage enable row level security;

create function open_index.enforce_record_vote_budget()
returns trigger language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare
  account text := lower(new.voter);
  policy open_index.record_vote_budgets%rowtype;
  day date;
begin
  if new.value is distinct from 1 then return null; end if;
  if tg_op = 'UPDATE' then
    if old.value = 1 then return null; end if;
  end if;
  select * into policy from open_index.record_vote_budgets where voter = account for share;
  if not found then return null; end if;
  day := (statement_timestamp() at time zone policy.timezone)::date;
  if day < policy.starts_on then return null; end if;

  -- Concurrent writes for the same account and day contend on the same counter row.
  -- A refused vote aborts this statement, so neither the vote nor tally persists.
  insert into open_index.record_vote_usage as usage (voter, local_day, used)
  values (account, day, 1)
  on conflict (voter, local_day) do update set used = usage.used + 1
    where usage.used < policy.daily_limit;
  if not found then
    raise exception using errcode = 'DV001', message = 'record_vote_daily_budget_reached';
  end if;
  return null;
end;
$$;

-- AFTER means ON CONFLICT DO NOTHING does not consume a second slot.
-- Do not refund on deletion/downvote. Re-creating an upvote is a new action.
create trigger votes_budget after insert or update of value on open_index.votes
  for each row execute function open_index.enforce_record_vote_budget();
