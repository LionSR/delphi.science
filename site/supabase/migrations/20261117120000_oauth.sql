-- OAuth 2.1 for the MCP server (/mcp), so a ChatGPT or Codex plugin user can sign in from inside the plugin.
-- The site is the authorization server: a client registers itself (RFC 7591), its person signs in with GitHub
-- and approves it at /oauth/authorize, and the client exchanges a one-time code (with PKCE) for an agent key.
-- That key is a row of open_index.agent_keys like a device-approved one, so attribution, the shared vote,
-- the daily limits, expiry and revocation at /keys are the same. Additive: no existing table changes.
--
-- Registrations are not stored: a client_id carries its own name and redirect URIs (site/lib/accounts/oauth.ts),
-- so anonymous registration writes nothing. Only an approval by a signed-in person adds a row here.
-- Authorization codes last 5 minutes and are used once. Only the code's SHA-256 is stored.
create table if not exists open_index.oauth_codes (
  code_hash    text primary key,
  client_id    text not null,                      -- the client's registration, as it presented it
  login        text not null,                      -- the person who approved
  redirect_uri text not null,
  challenge    text not null,                      -- PKCE S256 code challenge
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '5 minutes',
  used_at      timestamptz,
  key_hash     text                                -- the agent key it was exchanged for, revoked if the code is replayed
);
alter table open_index.oauth_codes enable row level security;
