// POST /api/v1/forum/<id>/accept {"post": <answer id>}: the asker accepts an answer, or un-accepts it (acceptAnswer).
import { db } from '#lib/db.ts';
import { accept } from '#lib/posts/forum.ts';
import { operation } from '#lib/api/operation.ts';
import { FORUM } from '#lib/posts/visibility.ts';

export const POST = operation('acceptAnswer', async ({ params, body, voter }) =>
	Response.json(await accept(await db(), params.id, body.post, voter, FORUM)));
