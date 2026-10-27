-- Analytics contain only fixed categories. Remove legacy arbitrary tokens/path names rather than
-- preserve possible identifiers. Apply before enabling ORI_USAGE_ANALYTICS_ENABLED.
DELETE FROM open_index.api_usage
 WHERE client NOT IN ('Claude-User', 'Claude-SearchBot', 'ClaudeBot', 'Claude-Web', 'claude-code', 'anthropic-ai', 'ChatGPT-User', 'OAI-SearchBot', 'GPTBot', 'codex', 'Perplexity-User', 'PerplexityBot', 'MistralAI-User', 'DuckAssistBot', 'Google-CloudVertexBot', 'Gemini-Deep-Research', 'GoogleAgent-Mariner', 'meta-externalagent', 'meta-externalfetcher', 'Amazonbot', 'Bytespider', 'CCBot', 'cohere-ai', 'YouBot', 'AI2Bot', 'PhindBot', 'Diffbot', 'Googlebot', 'GoogleOther', 'bingbot', 'Applebot', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'PetalBot', 'Kagibot', 'HeadlessChrome', 'curl', 'python-requests', 'python-urllib', 'python-httpx', 'go-http-client', 'node', 'wget', 'axios', 'postmanruntime', 'browser', 'none', 'other')
    OR endpoint NOT IN ('GET /api/v1/search', 'GET /api/v1/records/{prefix}/{suffix}', 'GET /api/v1/records/{prefix}/{suffix}/comments', 'POST /api/v1/records/{prefix}/{suffix}/comments', 'GET /api/v1/records/{prefix}/{suffix}/vote', 'POST /api/v1/records/{prefix}/{suffix}/vote', 'DELETE /api/v1/records/{prefix}/{suffix}/vote', 'POST /api/v1/submit', 'GET /api/v1/forum', 'POST /api/v1/forum', 'GET /api/v1/forum/{id}', 'POST /api/v1/forum/{id}', 'POST /api/v1/forum/{id}/vote', 'POST /api/v1/forum/{id}/accept', 'GET /api/v1/prefixes', 'GET /api/v1/stats', 'POST /api/v1/keys/device', 'POST /api/v1/keys/token', 'GET /api/v1', 'GET /api/v1/openapi.json', 'GET /llms.txt', 'POST /mcp', 'GET /id/{prefix}/{suffix}', 'GET /sitemap.xml', 'GET /sitemap/{file}')
    OR day < (now() AT TIME ZONE 'utc')::date - 89
    OR day > (now() AT TIME ZONE 'utc')::date;
ALTER TABLE open_index.api_usage
 ADD CONSTRAINT api_usage_client_category CHECK (client IN ('Claude-User', 'Claude-SearchBot', 'ClaudeBot', 'Claude-Web', 'claude-code', 'anthropic-ai', 'ChatGPT-User', 'OAI-SearchBot', 'GPTBot', 'codex', 'Perplexity-User', 'PerplexityBot', 'MistralAI-User', 'DuckAssistBot', 'Google-CloudVertexBot', 'Gemini-Deep-Research', 'GoogleAgent-Mariner', 'meta-externalagent', 'meta-externalfetcher', 'Amazonbot', 'Bytespider', 'CCBot', 'cohere-ai', 'YouBot', 'AI2Bot', 'PhindBot', 'Diffbot', 'Googlebot', 'GoogleOther', 'bingbot', 'Applebot', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'PetalBot', 'Kagibot', 'HeadlessChrome', 'curl', 'python-requests', 'python-urllib', 'python-httpx', 'go-http-client', 'node', 'wget', 'axios', 'postmanruntime', 'browser', 'none', 'other')),
 ADD CONSTRAINT api_usage_endpoint_category CHECK (endpoint IN ('GET /api/v1/search', 'GET /api/v1/records/{prefix}/{suffix}', 'GET /api/v1/records/{prefix}/{suffix}/comments', 'POST /api/v1/records/{prefix}/{suffix}/comments', 'GET /api/v1/records/{prefix}/{suffix}/vote', 'POST /api/v1/records/{prefix}/{suffix}/vote', 'DELETE /api/v1/records/{prefix}/{suffix}/vote', 'POST /api/v1/submit', 'GET /api/v1/forum', 'POST /api/v1/forum', 'GET /api/v1/forum/{id}', 'POST /api/v1/forum/{id}', 'POST /api/v1/forum/{id}/vote', 'POST /api/v1/forum/{id}/accept', 'GET /api/v1/prefixes', 'GET /api/v1/stats', 'POST /api/v1/keys/device', 'POST /api/v1/keys/token', 'GET /api/v1', 'GET /api/v1/openapi.json', 'GET /llms.txt', 'POST /mcp', 'GET /id/{prefix}/{suffix}', 'GET /sitemap.xml', 'GET /sitemap/{file}')),
 ADD CONSTRAINT api_usage_nonnegative CHECK (calls >= 0);
-- No public read policy: access is only through the server and the application admin check.
ALTER TABLE open_index.api_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON open_index.api_usage FROM PUBLIC;
-- PGlite local tests have no Supabase roles. Revoke these grants when the roles exist.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
  REVOKE ALL ON open_index.api_usage FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
  REVOKE ALL ON open_index.api_usage FROM authenticated;
 END IF;
END $$;
