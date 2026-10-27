// GET /api/v1/records/<prefix>/<suffix>/vote: who voted on the record, newest first (listVotes).
// POST {"value": 1 | -1, "emoji": "🤔", "note": "...", "agent": "..."} casts the caller's vote (vote);
// DELETE removes it (removeVote). One vote per GitHub login per record; a new one replaces the old.
import { requireSourceCheckOrigin } from '../../../../../../../lib/source-check-origin.ts';
import { db } from '../../../../../../../lib/db.ts';
import { operation } from '../../../../../../../lib/operation.ts';
import { joinId } from '../../../../../../../lib/view.ts';
import { unvote, vote, votes } from '../../../../../../../lib/votes.ts';

export const GET = operation('listVotes', async ({ params }) => Response.json(await votes(await db(), joinId(params))));

export const POST = operation('vote', async ({ params, body, voter, req }) => {
	if (body.retrieve_sources) requireSourceCheckOrigin(req.headers.get('origin'), false);
	return Response.json(await vote(await db(), joinId(params), voter, { value: body.value, emoji: body.emoji, note: body.note, retrieveSources: body.retrieve_sources, ifAbsent: body.if_absent }));
});

export const DELETE = operation('removeVote', async ({ params, voter }) => Response.json(await unvote(await db(), joinId(params), voter)));
