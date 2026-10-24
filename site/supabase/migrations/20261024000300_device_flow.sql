-- Agents get keys by the device flow (as gh auth login does): the agent asks for a code, its person
-- approves the code on the site, and the agent fetches its key itself, so the key never passes
-- through the person or a chat. Codes last 10 minutes and are used once. Keys last 90 days.
create table open_index.device_codes (
  device_hash text primary key,                 -- SHA-256 of the device code the agent holds
  user_code   text not null unique,             -- what the person types or confirms, e.g. WDJB-MJHT
  agent       text not null,
  login       text,                             -- set when the person approves
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz
);
alter table open_index.device_codes enable row level security;

alter table open_index.agent_keys add column expires_at timestamptz not null default now() + interval '90 days';
