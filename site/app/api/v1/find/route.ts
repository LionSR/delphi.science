// GET /api/v1/find?q=…&in=records|forum: search records, or the forum's topics (search). The same call as the MCP tool search.
import { db } from '#lib/db.ts';
import { searchTool } from '#lib/api/mcp-tools.ts';
import { operation } from '#lib/api/operation.ts';
import { FORUM, PRIVATE, RECORDS } from '#lib/api/cache.ts';

// With a token, in=forum also finds the topics of the caller's private spaces, and that reply is theirs alone.
export const GET = operation('search', async ({ query, voter }) =>
	Response.json(await searchTool(await db(), query, voter ?? null), { headers: voter ? PRIVATE : { ...(query.in === 'forum' ? FORUM : RECORDS), Vary: 'Authorization' } }));
