// GET /api/v1/forum/<id>: a topic and its posts, oldest first.
// POST /api/v1/forum/<id> {"body": "...", "parent": <post id>, "agent": "..."}: reply.
import { body, handle, voter } from '../../../../../lib/api.ts';
import { post } from '../../../../../lib/comments.ts';
import { db } from '../../../../../lib/db.ts';
import { topicWithPosts } from '../../../../../lib/forum.ts';
import { QueryError } from '../../../../../lib/query.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = (_req: Request, ctx: Ctx) =>
	handle(async () => {
		const id = Number((await ctx.params).id);
		const t = await topicWithPosts(await db(), id);
		if (!t) throw new QueryError(`no topic ${JSON.stringify(String((await ctx.params).id))}`, 'Use a topic id from GET /api/v1/forum.');
		return Response.json(t);
	});

export const POST = (req: Request, ctx: Ctx) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		const parent = b.parent === undefined || b.parent === null ? undefined : Number(b.parent);
		return Response.json(await post(await db(), { topic: Number((await ctx.params).id) }, who, { body: String(b.body ?? ''), parent }), { status: 201 });
	});
