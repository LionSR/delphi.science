// GET /.well-known/oauth-authorization-server: OAuth authorization server metadata (RFC 8414) for the MCP server's
// sign-in. Also answers with a path after it (…/mcp), where some clients look first.
import { authorizationServer } from '#lib/accounts/oauth.ts';
import { metadata, preflight } from '#lib/api/oauth-http.ts';

export const GET = () => metadata(authorizationServer());
export const OPTIONS = preflight;
