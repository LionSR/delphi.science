// GET /.well-known/oauth-protected-resource and …/mcp: protected resource metadata (RFC 9728) for the MCP server,
// naming this site as its authorization server.
import { protectedResource } from '#lib/accounts/oauth.ts';
import { metadata, preflight } from '#lib/api/oauth-http.ts';

export const GET = () => metadata(protectedResource());
export const OPTIONS = preflight;
