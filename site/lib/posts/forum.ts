// The forum: questions, voted answers (the asker may accept one), and comments. Posting goes through comments.ts.
import { startQuestion, thread, type Post } from './comments.ts';
import type { Moderator } from '#lib/moderation/moderate.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import { pageInfo, pageLimit, pageSize, pageStart, type PageRequest } from '#lib/paging.ts';
import type { Db } from '#lib/db.ts';
import { refuseKeys, type Voter } from '#lib/accounts/keys.ts';

type Topic = { id: number; title: string; voter: string; agent: string; at: string; last_at: string;
	score: number; answers: number; accepted_id: number | null };

/** A title as stored: trimmed, with each run of whitespace made one space. */
export const topicTitle = (title: string) => (title ?? '').trim().replace(/\s+/g, ' ');

/** Asks a question; its body is the first post. Returns the question in full. */
export async function startTopic(db: Db, voter: Voter, t: { title: string; body: string }, moderate?: Moderator) {
	const title = topicTitle(t.title);
	if (!title) throw new QueryError('the topic needs a title', 'Send "title" and "body".');
	if (title.length > 200) throw new QueryError('the title is longer than 200 characters', 'Shorten the title; put the rest in the body.');
	if (!(t.body ?? '').trim()) throw new QueryError('the topic needs a body', 'Send "body": the question or what you want to discuss, with what is known and the records involved.');
	await refuseKeys(db, title);
	const id = await startQuestion(db, voter, title, t.body, moderate);
	return (await topicWithPosts(db, id))!;
}

const TOPIC = `SELECT t.id::int, t.title, t.voter, t.agent, t.at, t.last_at, t.accepted_id::int, t.score, t.answers_count AS answers
	FROM open_index.topics t`;

/** The forum's page size (lib/paging.ts), for topics and for the latest posts. */
export const FORUM_PAGE = pageSize('Topics and latest posts', 100, 30);

// The topics matching $1, each with its best rank. websearch_to_tsquery accepts any text without error.
const MATCHES = `WITH query AS (SELECT websearch_to_tsquery('english', $1) AS tq),
	hits AS (SELECT t.id, ts_rank(t.tsv, query.tq) * 2 AS rank FROM open_index.topics t, query WHERE t.tsv @@ query.tq
	         UNION ALL
	         SELECT c.topic_id, ts_rank(c.tsv, query.tq) FROM open_index.comments c, query WHERE c.topic_id IS NOT NULL AND c.tsv @@ query.tq),
	best AS (SELECT id, max(rank) AS rank FROM hits GROUP BY id)`;

/** One page of questions (lib/paging.ts): the latest activity first, or with q, the best matches of the words in
 * titles and posts. */
export async function topics(db: Db, opts: PageRequest & { q?: string } = {}) {
	const start = pageStart(opts, FORUM_PAGE);
	const q = (opts.q ?? '').trim();
	const [list, count, args] = q
		? [`${MATCHES} ${TOPIC} JOIN best ON best.id = t.id ORDER BY best.rank DESC, t.last_at DESC, t.id DESC LIMIT $2 OFFSET $3`, `${MATCHES} SELECT count(*)::int AS n FROM best`, [q]]
		: [`${TOPIC} ORDER BY t.last_at DESC, t.id DESC LIMIT $1 OFFSET $2`, 'SELECT count(*)::int AS n FROM open_index.topics', []];
	const [questions, total] = await Promise.all([
		db.query<Topic>(list, [...args, start.limit, start.offset]).then((r) => r.rows),
		start.total ?? db.query<{ n: number }>(count, args).then((r) => r.rows[0].n),
	]);
	return { questions, ...pageInfo(start, total, questions.length) };
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
	if (!p) throw new NotFoundError(`no post ${postId} in topic ${topicId}`, 'Use a post id from GET /api/v1/forum/<id>.');
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
	if (!t) throw new NotFoundError(`no topic ${topicId}`, 'Use a topic id from GET /api/v1/forum.');
	if (t.voter !== voter.login) throw new QueryError('only the asker can accept an answer', 'Vote on it instead.');
	if (!t.answers.some((a) => a.id === postId)) throw new QueryError(`post ${postId} is not an answer to this question`, 'Accept an id from answers[].');
	const next = t.accepted_id === postId ? null : postId;
	await db.query('UPDATE open_index.topics SET accepted_id = $1 WHERE id = $2', [next, topicId]);
	return { topic: topicId, accepted_id: next };
}

type Activity = { id: number; voter: string; agent: string; body: string; review: boolean; at: string;
	record_id: string | null; topic_id: number | null; title: string };

/** All posts with the title they were posted under: newest first, or with since (a post id), the later ones oldest first. */
export async function activity(db: Db, opts: { since?: number; limit?: number } = {}) {
	const limit = pageLimit(opts.limit, FORUM_PAGE);
	const since = Number.isSafeInteger(opts.since) ? opts.since : undefined;
	const posts = (await db.query<Activity>(
		`SELECT c.id::int, c.voter, c.agent, c.body, c.review, c.at, c.record_id, c.topic_id::int, coalesce(t.title, r.title) AS title
		 FROM open_index.comments c LEFT JOIN open_index.topics t ON t.id = c.topic_id LEFT JOIN open_index.records r ON r.id = c.record_id
		 ${since === undefined ? 'ORDER BY c.id DESC LIMIT $1' : 'WHERE c.id > $2 ORDER BY c.id LIMIT $1'}`,
		since === undefined ? [limit] : [limit, since])).rows;
	const newest = Math.max(since ?? 0, ...posts.map((p) => p.id));
	return { posts, since: newest };
}

/** The voter's own votes on these posts, by post id. */
export async function myPostVotes(db: Db, login: string, ids: number[]) {
	const rows = (await db.query<{ id: number; value: number }>(
		'SELECT comment_id::int AS id, value FROM open_index.post_votes WHERE voter = $1 AND comment_id = ANY($2)', [login, ids])).rows;
	return new Map(rows.map((r) => [r.id, r.value]));
}
