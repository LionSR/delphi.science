-- How the API is used: calls per day, endpoint and client, in aggregate (lib/usage.ts). The client is a
-- name read from the user agent (ClaudeBot, python-requests, curl, browser), the endpoint the route
-- pattern. No IP address, full user agent or URL is stored. /api/v1/stats and /stats read it.
create table open_index.api_usage (
  day      date not null,                    -- UTC
  endpoint text not null,                    -- method and route, e.g. GET /api/v1/records/{prefix}/{suffix}
  client   text not null,                    -- e.g. ClaudeBot, ChatGPT-User, python-requests, browser
  calls    integer not null default 0,
  primary key (day, endpoint, client)
);
alter table open_index.api_usage enable row level security;
