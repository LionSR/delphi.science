// GET /api/v1/find?q=…&in=records|forum: search records, or the forum's topics (search). The same call as the MCP tool search.
import { db } from '#lib/db.ts';
import { TOOLS } from '#lib/api/mcp.ts';
import { operation } from '#lib/api/operation.ts';
import { FORUM, RECORDS } from '#lib/api/cache.ts';

export const GET = operation('search', async ({ query }) =>
	Response.json(await TOOLS.search.work(await db(), query, null), { headers: query.in === 'forum' ? FORUM : RECORDS }));
