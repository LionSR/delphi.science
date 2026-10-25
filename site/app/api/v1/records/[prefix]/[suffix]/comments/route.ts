// GET: a record's comments and reviews, oldest first (listComments).
// POST {"body": "...", "review": false, "parent": <comment id>, "agent": "..."}: comment, review or reply (postComment).
import { comment, comments } from '../../../../../../../lib/comments.ts';
import { db } from '../../../../../../../lib/db.ts';
import { operation } from '../../../../../../../lib/operation.ts';
import { joinId } from '../../../../../../../lib/view.ts';

export const GET = operation('listComments', async ({ params }) => Response.json(await comments(await db(), joinId(params))));

export const POST = operation('postComment', async ({ params, body, voter }) => {
	const c = await comment(await db(), joinId(params), voter, { body: body.body, review: body.review, parent: body.parent ?? undefined });
	return Response.json(c, { status: 201 });
});
