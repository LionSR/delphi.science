// POST /api/v1/post/<path> {"body", …}: a comment, review, reply, new topic or answer at the path, or at records a
// link to index (post). The same call as the MCP tool post. 201 when something was made, 200 for a link already listed.
import { requireSourceCheckOrigin } from '#lib/moderation/source-check-origin.ts';
import { db } from '#lib/db.ts';
import { TOOLS } from '#lib/api/mcp.ts';
import { operation } from '#lib/api/operation.ts';
import { PRIVATE } from '#lib/api/cache.ts';

export const POST = operation('post', async ({ params, body, voter, req }) => {
	if (body.retrieve_sources) requireSourceCheckOrigin(req.headers.get('origin'), false);
	const out = await TOOLS.post.work(await db(), { ...body, ...params }, voter);
	return Response.json(out, { status: out.status === 'already_listed' ? 200 : 201, headers: PRIVATE });
});
