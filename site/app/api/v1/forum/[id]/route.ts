// GET /api/v1/forum/<id>: a question, its comments, and its answers (accepted first, then by score) (getTopic).
// POST /api/v1/forum/<id> {"body": "...", "agent": "..."}: answer; with "parent": <post id>, comment on that post (answerQuestion).
import { post } from '../../../../../lib/comments.ts';
import { db } from '../../../../../lib/db.ts';
import { topicWithPosts } from '../../../../../lib/forum.ts';
import { requireSourceCheckOrigin } from '../../../../../lib/source-check-origin.ts';
import { operation } from '../../../../../lib/operation.ts';
import { QueryError } from '../../../../../lib/query.ts';

export const GET = operation('getTopic', async ({ params }) => {
	const t = await topicWithPosts(await db(), params.id);
	if (!t) throw new QueryError(`no topic ${params.id}`, 'Use a topic id from GET /api/v1/forum.');
	return Response.json(t, { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60' } });
});

export const POST = operation('answerQuestion', async ({ req, params, body, voter }) => {
	if (body.retrieve_sources) requireSourceCheckOrigin(req.headers.get('origin'), false);
	return Response.json(await post(await db(), { topic: params.id }, voter, { body: body.body, parent: body.parent, retrieveSources: body.retrieve_sources }), { status: 201 });
});
