// PATCH /api/v1/edit/<post path> {"body", "revision"}: replace a post's text (edit). The same call as the MCP tool edit.
import { db } from '#lib/db.ts';
import { editTool } from '#lib/api/mcp-tools.ts';
import { operation } from '#lib/api/operation.ts';
import { PRIVATE } from '#lib/api/cache.ts';

export const PATCH = operation('edit', async ({ params, body, voter }) =>
	Response.json(await editTool(await db(), { ...body, ...params }, voter, 'rest'), { headers: PRIVATE }));
