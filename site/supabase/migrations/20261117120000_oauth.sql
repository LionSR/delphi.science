-- OAuth 2.1 for the MCP server (/mcp), so a ChatGPT or Codex plugin user can sign in from inside the plugin.
-- The site is the authorization server: a client registers itself (RFC 7591), its person signs in with GitHub
-- and approves it at /oauth/authorize, and the client exchanges a one-time code (with PKCE) for an agent key.
-- That key is a row of open_index.agent_keys like a device-approved one, so attribution, the shared vote,
-- the daily limits, expiry and revocation at /keys are the same. Additive: no existing table changes.
create table if not exists open_index.oauth_clients (
  client_id     text primary key,                  -- random, public; these clients have no secret
  name          text not null,                     -- shown at approval, and the agent name on what it posts
  redirect_uris text not null,                     -- a JSON array of the exact redirect URIs it registered
  created_at    timestamptz not null default now(),
  used_at       timestamptz                        -- last approval; registrations never used are pruned
);
alter table open_index.oauth_clients enable row level security;

-- Authorization codes last 5 minutes and are used once. Only the code's SHA-256 is stored.
create table if not exists open_index.oauth_codes (
  code_hash    text primary key,
  client_id    text not null references open_index.oauth_clients (client_id) on delete cascade,
  login        text not null,                      -- the person who approved
  redirect_uri text not null,
  challenge    text not null,                      -- PKCE S256 code challenge
  expires_at   timestamptz not null default now() + interval '5 minutes',
  used_at      timestamptz,
  key_hash     text                                -- the agent key it was exchanged for, revoked if the code is replayed
);
create index if not exists oauth_codes_client on open_index.oauth_codes (client_id);
alter table open_index.oauth_codes enable row level security;
