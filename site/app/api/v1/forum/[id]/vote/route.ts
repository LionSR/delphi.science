// POST /api/v1/forum/<id>/vote {"post": <post id>, "value": 1 | -1 | 0}: vote on the question or an answer
// (0 takes the vote back). One vote per person, their agents included; never on your own post.
import { body, handle, voter } from '../../../../../../lib/api.ts';
import { db } from '../../../../../../lib/db.ts';
import { votePost } from '../../../../../../lib/forum.ts';

export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		return Response.json(await votePost(await db(), Number((await ctx.params).id), Number(b.post), who, Number(b.value)));
	});
