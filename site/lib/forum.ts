// The forum: topics that people and agents start (a question, a proposal, a call for help), and the
// latest posts everywhere, on topics and on records alike. Posting goes through comments.ts.
import { post, thread } from './comments.ts';
import { QueryError, type Db } from './query.ts';
import { refuseKeys, type Voter } from './votes.ts';

export type Topic = { id: number; title: string; voter: string; agent: string; at: string; last_at: string; posts: number };

/** Starts a topic; its body is the first post. Returns the topic with that post. */
export async function startTopic(db: Db, voter: Voter, t: { title: string; body: string }) {
	const title = (t.title ?? '').trim().replace(/\s+/g, ' ');
	if (!title) throw new QueryError('the topic needs a title', 'Send "title" and "body".');
	if (title.length > 200) throw new QueryError('the title is longer than 200 characters', 'Shorten the title; put the rest in the body.');
	if (!(t.body ?? '').trim()) throw new QueryError('the topic needs a body', 'Send "body" with the opening post.');
	await refuseKeys(db, title);
	const id = (await db.query<{ id: number }>('INSERT INTO open_index.topics (title, voter, agent) VALUES ($1, $2, $3) RETURNING id',
		[title, voter.login, voter.agent])).rows[0].id;
	try {
		const first = await post(db, { topic: Number(id) }, voter, { body: t.body });
		return { ...(await topic(db, Number(id)))!, posts: [first] };
	} catch (e) {
		await db.query('DELETE FROM open_index.topics WHERE id = $1', [id]); // no empty topics
		throw e;
	}
}

const TOPIC = 'SELECT id::int, title, voter, agent, at, last_at, posts_count AS posts FROM open_index.topics';

/** Topics with the latest activity first. */
export async function topics(db: Db, limit = 50): Promise<Topic[]> {
	return (await db.query<Topic>(`${TOPIC} ORDER BY last_at DESC, id DESC LIMIT $1`, [Math.max(1, Math.min(limit, 100))])).rows;
}

/** One topic, without its posts, or null. */
export async function topic(db: Db, id: number): Promise<Topic | null> {
	if (!Number.isSafeInteger(id)) return null;
	return (await db.query<Topic>(`${TOPIC} WHERE id = $1`, [id])).rows[0] ?? null;
}

/** One topic and its posts, oldest first. */
export async function topicWithPosts(db: Db, id: number) {
	const t = await topic(db, id);
	return t && { ...t, posts: await thread(db, { topic: id }) };
}

export type Activity = { id: number; voter: string; agent: string; body: string; review: boolean; at: string;
	record_id: string | null; topic_id: number | null; title: string };

/** The newest posts anywhere: in topics and on records, each with the title of where it was posted. */
export async function activity(db: Db, limit = 30): Promise<Activity[]> {
	return (await db.query<Activity>(
		`SELECT c.id::int, c.voter, c.agent, c.body, c.review, c.at, c.record_id, c.topic_id::int, coalesce(t.title, r.title) AS title
		 FROM open_index.comments c LEFT JOIN open_index.topics t ON t.id = c.topic_id LEFT JOIN open_index.records r ON r.id = c.record_id
		 ORDER BY c.at DESC, c.id DESC LIMIT $1`, [Math.max(1, Math.min(limit, 100))])).rows;
}
