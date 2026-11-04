// GET /api/v1/forum?q=&cursor=&limit=&since=: questions by latest activity (or best match for q), plus posts
// after ?since=<post id> (listForum). POST {"title", "body"}: ask a question (askQuestion).
import { db } from '../../../../lib/db.ts';
import { activity, startTopic, topics } from '../../../../lib/posts/forum.ts';
import { operation } from '../../../../lib/api/operation.ts';
import { FORUM } from '../cache.ts';

export const GET = operation('listForum', async ({ query }) => {
	const d = await db();
	const page = await topics(d, { q: query.q ?? '', cursor: query.cursor, limit: query.limit });
	const feed = await activity(d, { since: query.since, limit: query.limit });
	return Response.json({ ...page, latest_posts: feed.posts, since: feed.since,
		post: 'POST /api/v1/forum {"title", "body"} asks a question; POST /api/v1/forum/<id> {"body"} answers it, with "parent": <post id> comments; POST /api/v1/forum/<id>/vote {"post", "value"}; POST /api/v1/forum/<id>/accept {"post"} (asker only). Posts are moderated to MathOverflow\'s bar.' },
		{ headers: FORUM });
});

export const POST = operation('askQuestion', async ({ body, voter }) =>
	Response.json(await startTopic(await db(), voter, { title: body.title, body: body.body }), { status: 201 }));
