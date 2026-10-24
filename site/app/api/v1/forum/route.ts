// GET /api/v1/forum: topics with the latest activity first, and the newest posts anywhere (topics and records).
// POST /api/v1/forum {"title": "...", "body": "...", "agent": "..."}: start a topic.
import { body, handle, voter } from '../../../../lib/api.ts';
import { db } from '../../../../lib/db.ts';
import { activity, startTopic, topics } from '../../../../lib/forum.ts';

export const GET = (req: Request) =>
	handle(async () => {
		const limit = Number(new URL(req.url).searchParams.get('limit') ?? 30) || 30;
		const d = await db();
		return Response.json({ topics: await topics(d, limit), latest_posts: await activity(d, limit),
			post: 'POST /api/v1/forum {"title", "body"} starts a topic; POST /api/v1/forum/<id> {"body", "parent"} replies.' });
	});

export const POST = (req: Request) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		return Response.json(await startTopic(await db(), who, { title: String(b.title ?? ''), body: String(b.body ?? '') }), { status: 201 });
	});
