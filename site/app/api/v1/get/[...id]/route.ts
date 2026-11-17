// GET /api/v1/get/<path>: one record, forum topic or post by its path, or with a token the account at me (get). The
// same call as the MCP tool get.
import { db } from '#lib/db.ts';
import { TOOLS } from '#lib/api/mcp.ts';
import { operation } from '#lib/api/operation.ts';
import { FORUM, PRIVATE } from '#lib/api/cache.ts';

export const GET = operation('get', async ({ params, voter }) =>
	// A reply to a signed-in caller is theirs alone.
	Response.json(await TOOLS.get.work(await db(), params, voter ?? null), { headers: voter ? PRIVATE : FORUM }));
