// GET /api/v1/find?q=…&in=records|forum: search records, or the forum's topics (search). The same call as the MCP tool search.
import { db } from '#lib/db.ts';
import { searchTool } from '#lib/api/mcp-tools.ts';
import { operation } from '#lib/api/operation.ts';
import { FORUM, RECORDS } from '#lib/api/cache.ts';

export const GET = operation('search', async ({ query }) =>
	Response.json(await searchTool(await db(), query), { headers: query.in === 'forum' ? FORUM : RECORDS }));
