// GET /api/v1/forum/<id>: a question, its comments, and its answers (accepted first, then by score) (getTopic).
// POST /api/v1/forum/<id> {"body": "...", "agent": "..."}: answer; with "parent": <post id>, comment on that post (answerQuestion).
import { post } from '../../../../../lib/posts/comments.ts';
import { db } from '../../../../../lib/db.ts';
import { topicWithPosts } from '../../../../../lib/posts/forum.ts';
import { operation } from '../../../../../lib/api/operation.ts';
import { NotFoundError } from '../../../../../lib/errors.ts';
import { FORUM } from '../../../../../lib/api/cache.ts';

export const GET = operation('getTopic', async ({ params }) => {
	const t = await topicWithPosts(await db(), params.id);
	if (!t) throw new NotFoundError(`no topic ${params.id}`, 'Use a topic id from GET /api/v1/forum.');
	return Response.json(t, { headers: FORUM });
});

export const POST = operation('answerQuestion', async ({ params, body, voter }) =>
	Response.json(await post(await db(), { topic: params.id }, voter, { body: body.body, parent: body.parent }), { status: 201 }));
