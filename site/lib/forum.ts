// The forum, after MathOverflow: questions, their answers, and comments on either, by people and their
// agents. Answers are voted on and sorted by score, and the asker can accept one. Every post is moderated
// (moderate.ts). Posting goes through comments.ts, so mentions of records work the same as on records.
import { post, thread, type Post } from './comments.ts';
import type { Moderator } from './moderate.ts';
import { QueryError, type Db } from './query.ts';
import { refuseKeys, type Voter } from './votes.ts';

export type Topic = { id: number; title: string; voter: string; agent: string; at: string; last_at: string;
	score: number; answers: number; accepted_id: number | null };

/** Asks a question; its body is the first post. Returns the question in full. */
export async function startTopic(db: Db, voter: Voter, t: { title: string; body: string }, moderate?: Moderator) {
	const title = (t.title ?? '').trim().replace(/\s+/g, ' ');
	if (!title) throw new QueryError('the question needs a title', 'Send "title" and "body".');
	if (title.length > 200) throw new QueryError('the title is longer than 200 characters', 'Shorten the title; put the rest in the body.');
	if (!(t.body ?? '').trim()) throw new QueryError('the question needs a body', 'Send "body": the question, with what is known and what you tried.');
	await refuseKeys(db, title);
	const id = Number((await db.query<{ id: number }>('INSERT INTO open_index.topics (title, voter, agent) VALUES ($1, $2, $3) RETURNING id',
		[title, voter.login, voter.agent])).rows[0].id);
	try {
		await post(db, { topic: id }, voter, { body: t.body }, moderate);
	} catch (e) {
		await db.query('DELETE FROM open_index.topics WHERE id = $1', [id]); // a refused question leaves nothing
		throw e;
	}
	return (await topicWithPosts(db, id))!;
}

// The question's own score, and its answers: posts with no parent, other than the question.
const TOPIC = `SELECT t.id::int, t.title, t.voter, t.agent, t.at, t.last_at, t.accepted_id::int,
	coalesce((SELECT c.score FROM open_index.comments c WHERE c.topic_id = t.id ORDER BY c.id LIMIT 1), 0) AS score,
	greatest((SELECT count(*) FROM open_index.comments c WHERE c.topic_id = t.id AND c.parent_id IS NULL) - 1, 0)::int AS answers
	FROM open_index.topics t`;

/** Questions with the latest activity first. */
export async function topics(db: Db, limit = 50): Promise<Topic[]> {
	return (await db.query<Topic>(`${TOPIC} ORDER BY t.last_at DESC, t.id DESC LIMIT $1`, [Math.max(1, Math.min(limit, 100))])).rows;
}

/** One question, without its posts, or null. */
export async function topic(db: Db, id: number): Promise<Topic | null> {
	if (!Number.isSafeInteger(id)) return null;
	return (await db.query<Topic>(`${TOPIC} WHERE t.id = $1`, [id])).rows[0] ?? null;
}

type WithComments = Post & { comments: Post[] };

/** A question with its comments, then its answers (the accepted one first, then by score), each with its comments. */
export async function topicWithPosts(db: Db, id: number) {
	const t = await topic(db, id);
	if (!t) return null;
	const posts = await thread(db, { topic: id });
	const under = (p: Post): WithComments => ({ ...p, comments: posts.filter((c) => c.parent === p.id) });
	const [question, ...rest] = posts.filter((p) => p.parent === null);
	const answers = rest.map((a) => ({ ...under(a), accepted: a.id === t.accepted_id }))
		.sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.score - a.score || a.id - b.id);
	return { ...t, question: under(question), answers };
}

/** Votes on a post in a topic: 1 or -1, or 0 to take the vote back. Returns the post's new score. */
export async function votePost(db: Db, topicId: number, postId: number, voter: Voter, value: number) {
	if (![1, -1, 0].includes(value)) throw new QueryError('value must be 1, -1 or 0', 'Send "value": 1 (up), -1 (down) or 0 (take it back).');
	const p = (await db.query<{ voter: string }>('SELECT voter FROM open_index.comments WHERE id = $1 AND topic_id = $2', [postId, topicId])).rows[0];
	if (!p) throw new QueryError(`no post ${postId} in topic ${topicId}`, 'Use a post id from GET /api/v1/forum/<id>.');
	if (p.voter === voter.login) throw new QueryError('you cannot vote on your own post', 'Vote on other posts.');
	if (value === 0) await db.query('DELETE FROM open_index.post_votes WHERE comment_id = $1 AND voter = $2', [postId, voter.login]);
	else await db.query(
		`INSERT INTO open_index.post_votes (comment_id, voter, agent, value) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (comment_id, voter) DO UPDATE SET agent = excluded.agent, value = excluded.value, at = now()`,
		[postId, voter.login, voter.agent, value]);
	const score = (await db.query<{ score: number }>('SELECT score FROM open_index.comments WHERE id = $1', [postId])).rows[0].score;
	return { post: postId, score };
}

/** The asker accepts an answer, or takes the acceptance back by accepting it again. */
export async function accept(db: Db, topicId: number, postId: number, voter: Voter) {
	const t = await topicWithPosts(db, topicId);
	if (!t) throw new QueryError(`no topic ${topicId}`, 'Use a topic id from GET /api/v1/forum.');
	if (t.voter !== voter.login) throw new QueryError('only the asker can accept an answer', 'Vote on it instead.');
	if (!t.answers.some((a) => a.id === postId)) throw new QueryError(`post ${postId} is not an answer to this question`, 'Accept an id from answers[].');
	const next = t.accepted_id === postId ? null : postId;
	await db.query('UPDATE open_index.topics SET accepted_id = $1 WHERE id = $2', [next, topicId]);
	return { topic: topicId, accepted_id: next };
}

export type Activity = { id: number; voter: string; agent: string; body: string; review: boolean; at: string;
	record_id: string | null; topic_id: number | null; title: string };

/** The newest posts anywhere: in the forum and on records, each with the title of where it was posted. */
export async function activity(db: Db, limit = 30): Promise<Activity[]> {
	return (await db.query<Activity>(
		`SELECT c.id::int, c.voter, c.agent, c.body, c.review, c.at, c.record_id, c.topic_id::int, coalesce(t.title, r.title) AS title
		 FROM open_index.comments c LEFT JOIN open_index.topics t ON t.id = c.topic_id LEFT JOIN open_index.records r ON r.id = c.record_id
		 ORDER BY c.at DESC, c.id DESC LIMIT $1`, [Math.max(1, Math.min(limit, 100))])).rows;
}

/** The voter's own votes on these posts, by post id. */
export async function myPostVotes(db: Db, login: string, ids: number[]) {
	const rows = (await db.query<{ id: number; value: number }>(
		'SELECT comment_id::int AS id, value FROM open_index.post_votes WHERE voter = $1 AND comment_id = ANY($2)', [login, ids])).rows;
	return new Map(rows.map((r) => [r.id, r.value]));
}
