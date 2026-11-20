// POST /api/v1/vote/<path> {"value": 1 | -1 | 0, …}: vote on a record, forum topic or forum post, or accept an
// answer (vote). The same call as the MCP tool vote.
import { db } from '#lib/db.ts';
import { voteTool } from '#lib/api/mcp-tools.ts';
import { operation } from '#lib/api/operation.ts';
import { PRIVATE } from '#lib/api/cache.ts';

export const POST = operation('vote', async ({ params, body, voter }) => {
	return Response.json(await voteTool(await db(), { ...body, ...params }, voter, 'rest'), { headers: PRIVATE });
});
