// POST /oauth/register: Dynamic Client Registration (RFC 7591) for public OAuth clients of the MCP server.
import { registerClient } from '#lib/accounts/oauth.ts';
import { fields, oauthReply, preflight } from '#lib/api/oauth-http.ts';
import { db } from '#lib/db.ts';

export const POST = (req: Request) => oauthReply(async () => registerClient(await db(), await fields(req)), 201);
export const OPTIONS = preflight;
