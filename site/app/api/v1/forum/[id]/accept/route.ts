// POST /api/v1/forum/<id>/accept {"post": <answer id>}: the asker accepts an answer (again: takes it back).
import { body, handle, voter } from '../../../../../../lib/api.ts';
import { db } from '../../../../../../lib/db.ts';
import { accept } from '../../../../../../lib/forum.ts';

export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		return Response.json(await accept(await db(), Number((await ctx.params).id), Number(b.post), who));
	});
