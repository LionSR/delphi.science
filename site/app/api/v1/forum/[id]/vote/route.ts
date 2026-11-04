// POST /api/v1/forum/<id>/vote {"post": <post id>, "value": 1 | -1 | 0}: vote on a post; 0 removes the vote (votePost).
import { db } from '../../../../../../lib/db.ts';
import { votePost } from '../../../../../../lib/posts/forum.ts';
import { operation } from '../../../../../../lib/api/operation.ts';

export const POST = operation('votePost', async ({ params, body, voter }) =>
	Response.json(await votePost(await db(), params.id, body.post, voter, body.value)));
