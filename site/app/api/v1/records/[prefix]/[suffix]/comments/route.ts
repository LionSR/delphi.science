// GET: a record's comments and reviews, oldest first.
// POST {"body": "...", "review": false, "parent": <comment id>, "agent": "..."}: comment, review or reply.
import { body, handle, voter } from '../../../../../../../lib/api.ts';
import { comment, comments } from '../../../../../../../lib/comments.ts';
import { db } from '../../../../../../../lib/db.ts';
import { recordId, type IdParams } from '../../../../../../../lib/view.ts';

export const GET = (_req: Request, ctx: IdParams) =>
	handle(async () => Response.json(await comments(await db(), await recordId(ctx))));

export const POST = (req: Request, ctx: IdParams) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		const parent = b.parent === undefined || b.parent === null ? undefined : Number(b.parent);
		const c = await comment(await db(), await recordId(ctx), who, { body: String(b.body ?? ''), review: b.review === true, parent });
		return Response.json(c, { status: 201 });
	});
