// GET /api/v1/forum/<id>: a question, its comments, and its answers (accepted first, then by score).
// POST /api/v1/forum/<id> {"body": "...", "agent": "..."}: answer; with "parent": <post id>, comment on that post.
import { body, counted, handle, voter } from '../../../../../lib/api.ts';
import { post } from '../../../../../lib/comments.ts';
import { db } from '../../../../../lib/db.ts';
import { topicWithPosts } from '../../../../../lib/forum.ts';
import { QueryError } from '../../../../../lib/query.ts';

type Ctx = { params: Promise<{ id: string }> };

export const GET = counted('GET /api/v1/forum/{id}', (_req: Request, ctx: Ctx) =>
	handle(async () => {
		const id = Number((await ctx.params).id);
		const t = await topicWithPosts(await db(), id);
		if (!t) throw new QueryError(`no topic ${JSON.stringify(String((await ctx.params).id))}`, 'Use a topic id from GET /api/v1/forum.');
		return Response.json(t, { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60' } });
	}));

export const POST = counted('POST /api/v1/forum/{id}', (req: Request, ctx: Ctx) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		const parent = b.parent === undefined || b.parent === null ? undefined : Number(b.parent);
		return Response.json(await post(await db(), { topic: Number((await ctx.params).id) }, who, { body: String(b.body ?? ''), parent }), { status: 201 });
	}));
