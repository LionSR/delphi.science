// GET /api/v1/log?path=…&since=…: the posts under a path, newest first, or after since oldest first (log). The same
// call as the MCP tool log; format=text gives the tool's lines, one post each.
import { db } from '#lib/db.ts';
import { TOOLS } from '#lib/api/mcp.ts';
import { operation } from '#lib/api/operation.ts';
import { FORUM } from '#lib/api/cache.ts';

export const GET = operation('log', async ({ query: { format, ...args } }) => {
	const out = await TOOLS.log.work(await db(), args, null);
	if (format !== 'text') return Response.json(out, { headers: FORUM });
	// Through JSON first, as the tool does: times become strings.
	const text = TOOLS.log.text!(JSON.parse(JSON.stringify(out)));
	return new Response(text && `${text}\n`, { headers: { ...FORUM, 'Content-Type': 'text/plain; charset=utf-8' } });
});
