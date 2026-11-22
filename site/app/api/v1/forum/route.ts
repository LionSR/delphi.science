// GET /api/v1/forum?section=&q=&page=&cursor=&limit=&since=: questions by latest activity (or best match for q), plus posts
// after ?since=<post id> (listForum). POST {"title", "body", "section"?}: ask a question (askQuestion). These are the public
// forum's operations: they read as nobody signed in, and never reach a private space (ws paths, through the six verbs).
import { db } from '#lib/db.ts';
import { activity, startTopic, topics } from '#lib/posts/forum.ts';
import { FORUM as FORUM_SPACE } from '#lib/posts/visibility.ts';
import { operation } from '#lib/api/operation.ts';
import { FORUM } from '#lib/api/cache.ts';

/** A forum topic as these operations have always returned it, without the space it is in. */
const inForum = <T extends { space: string }>({ space: _, ...t }: T) => t;

export const GET = operation('listForum', async ({ query }) => {
	const d = await db();
	const [{ questions, ...page }, feed] = await Promise.all([topics(d, null, { ...query, space: FORUM_SPACE }), activity(d, query)]);
	return Response.json({ questions: questions.map(inForum), ...page, latest_posts: feed.posts, since: feed.since,
		post: 'POST /api/v1/forum {"title", "body"} asks a question; POST /api/v1/forum/<id> {"body"} answers it, with "parent": <post id> comments; POST /api/v1/forum/<id>/vote {"post", "value"}; POST /api/v1/forum/<id>/accept {"post"} (asker only). Posts are moderated to MathOverflow\'s standards.' },
		{ headers: FORUM });
});

export const POST = operation('askQuestion', async ({ body, voter }) =>
	Response.json(inForum(await startTopic(await db(), voter, { title: body.title, body: body.body, section: body.section })), { status: 201 }));
