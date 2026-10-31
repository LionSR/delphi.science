// GET /api/v1/records/<prefix>/<suffix>/vote: votes, newest first (listVotes).
// POST {"value", "emoji", "note"}: cast or replace the caller's vote (vote). DELETE removes it (removeVote).
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
