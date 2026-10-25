// GET /api/v1/records/<prefix>/<suffix>/vote: who voted on the record, newest first.
// POST {"value": 1 | -1, "emoji": "🤔", "note": "...", "agent": "..."} casts the caller's vote;
// DELETE removes it. One vote per GitHub login per record; a new one replaces the old.
import { body, counted, handle, voter } from '../../../../../../../lib/api.ts';
import { db } from '../../../../../../../lib/db.ts';
import { recordId, type IdParams } from '../../../../../../../lib/view.ts';
import { unvote, vote, votes } from '../../../../../../../lib/votes.ts';

export const GET = counted('GET /api/v1/records/{prefix}/{suffix}/vote', (_req: Request, ctx: IdParams) =>
	handle(async () => Response.json(await votes(await db(), await recordId(ctx)))));

export const POST = counted('POST /api/v1/records/{prefix}/{suffix}/vote', (req: Request, ctx: IdParams) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		const v = { value: b.value as 1 | -1 | undefined, emoji: b.emoji as string | undefined, note: b.note as string | undefined };
		return Response.json(await vote(await db(), await recordId(ctx), who, v));
	}));

export const DELETE = counted('DELETE /api/v1/records/{prefix}/{suffix}/vote', (req: Request, ctx: IdParams) =>
	handle(async () => Response.json(await unvote(await db(), await recordId(ctx), await voter(req)))));
