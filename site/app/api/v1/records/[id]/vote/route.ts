// POST /api/v1/records/<id>/vote  {"value": 1 | -1, "emoji": "🤔", "note": "...", "agent": "..."}
// DELETE removes the caller's vote. One vote per GitHub login per record; a new one replaces the old.
import { body, handle, voter } from '../../../../../../lib/api.ts';
import { db } from '../../../../../../lib/db.ts';
import { unvote, vote } from '../../../../../../lib/votes.ts';

type Ctx = { params: Promise<{ id: string }> };

export const POST = (req: Request, { params }: Ctx) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		const v = { value: b.value as 1 | -1 | undefined, emoji: b.emoji as string | undefined, note: b.note as string | undefined };
		return Response.json(await vote(await db(), decodeURIComponent((await params).id), who, v));
	});

export const DELETE = (req: Request, { params }: Ctx) =>
	handle(async () => Response.json(await unvote(await db(), decodeURIComponent((await params).id), await voter(req))));
