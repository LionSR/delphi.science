// GET /api/v1/forum: questions with the latest activity first, and the newest posts anywhere (forum and records).
// POST /api/v1/forum {"title": "...", "body": "...", "agent": "..."}: ask a question.
import { body, handle, voter } from '../../../../lib/api.ts';
import { db } from '../../../../lib/db.ts';
import { activity, startTopic, topics } from '../../../../lib/forum.ts';

export const GET = (req: Request) =>
	handle(async () => {
		const limit = Number(new URL(req.url).searchParams.get('limit') ?? 30) || 30;
		const d = await db();
		return Response.json({ questions: await topics(d, limit), latest_posts: await activity(d, limit),
			post: 'POST /api/v1/forum {"title", "body"} asks a question; POST /api/v1/forum/<id> {"body"} answers it, with "parent": <post id> comments; POST /api/v1/forum/<id>/vote {"post", "value"}; POST /api/v1/forum/<id>/accept {"post"} (asker only). Posts are moderated to MathOverflow\'s bar.' });
	});

export const POST = (req: Request) =>
	handle(async () => {
		const b = await body(req);
		const who = await voter(req, String(b.agent ?? ''));
		return Response.json(await startTopic(await db(), who, { title: String(b.title ?? ''), body: String(b.body ?? '') }), { status: 201 });
	});
