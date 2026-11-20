// Topics: questions, voted answers (the asker may accept one), and comments. The forum's, and those of every other
// space (spaces.ts). Posting goes through comments.ts. Every function here takes who is reading or acting and sees
// only the topics of spaces they can read (visibility.ts); a topic they cannot read is a topic that does not exist.
import { startQuestion, thread, type Post } from './comments.ts';
import type { Moderator } from '#lib/moderation/moderate.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import { pageInfo, pageLimit, pageSize, pageStart, type PageRequest } from '#lib/paging.ts';
import type { Db } from '#lib/db.ts';
import { refuseKeys, type Voter } from '#lib/accounts/keys.ts';
import { FORUM, POST_READABLE, READABLE, type Reader } from './visibility.ts';

export type Topic = { id: number; title: string; voter: string; agent: string; at: string; last_at: string;
	score: number; answers: number; accepted_id: number | null;
	/** The space it is in: 'forum', or a private space's slug. */
	space: string };

/** A title as stored: trimmed, with each run of whitespace made one space. */
export const topicTitle = (title: string) => (title ?? '').trim().replace(/\s+/g, ' ');

/** Asks a question; its body is the first post. Returns the question in full. In the forum unless `space` says where. */
export async function startTopic(db: Db, voter: Voter, t: { title: string; body: string; space?: string }, moderate?: Moderator) {
	const title = topicTitle(t.title);
	if (!title) throw new QueryError('the topic needs a title', 'Send "title" and "body".');
	if (title.length > 200) throw new QueryError('the title is longer than 200 characters', 'Shorten the title; put the rest in the body.');
	if (!(t.body ?? '').trim()) throw new QueryError('the topic needs a body', 'Send "body": the question or what you want to discuss, with what is known and the records involved.');
	await refuseKeys(db, title);
	const id = await startQuestion(db, voter, title, t.body, moderate, t.space ?? FORUM);
	return (await topicWithPosts(db, id, voter.login))!;
}

const TOPIC = `SELECT t.id::int, t.title, t.voter, t.agent, t.at, t.last_at, t.accepted_id::int, t.score, t.answers_count AS answers, t.space_id AS space
	FROM open_index.topics t`;

/** The forum's page size (lib/paging.ts), for topics and for the latest posts. */
export const FORUM_PAGE = pageSize('Topics and latest posts', 100, 30);

// The topics matching $1 that $2 can read, each with its best rank. websearch_to_tsquery accepts any text without
// error. Hits are filtered by the reader before they are ranked or counted, so a private post changes nothing here
// for anyone outside its space.
const MATCHES = `WITH query AS (SELECT websearch_to_tsquery('english', $1) AS tq),
	hits AS (SELECT t.id, ts_rank(t.tsv, query.tq) * 2 AS rank FROM open_index.topics t, query WHERE t.tsv @@ query.tq AND ${READABLE('t.space_id', '$2')} AND ($3::text IS NULL OR t.space_id = $3)
	         UNION ALL
	         SELECT c.topic_id, ts_rank(c.tsv, query.tq) FROM open_index.comments c JOIN open_index.topics t ON t.id = c.topic_id, query
	         WHERE c.topic_id IS NOT NULL AND c.tsv @@ query.tq AND ${READABLE('t.space_id', '$2')} AND ($3::text IS NULL OR t.space_id = $3)),
	best AS (SELECT id, max(rank) AS rank FROM hits GROUP BY id)`;

/** One page of questions (lib/paging.ts) among those `who` can read: the latest activity first, or with q, the best
 * matches of the words in titles and posts. `space` keeps it to one space; without it, every space they can read. */
export async function topics(db: Db, who: Reader, opts: PageRequest & { q?: string; space?: string } = {}) {
	const start = pageStart(opts, FORUM_PAGE);
	const q = (opts.q ?? '').trim();
	const mine = `${READABLE('t.space_id', '$1')} AND ($2::text IS NULL OR t.space_id = $2)`;
	const [list, count, args] = q
		? [`${MATCHES} ${TOPIC} JOIN best ON best.id = t.id ORDER BY best.rank DESC, t.last_at DESC, t.id DESC LIMIT $4 OFFSET $5`, `${MATCHES} SELECT count(*)::int AS n FROM best`, [q, who, opts.space ?? null]]
		: [`${TOPIC} WHERE ${mine} ORDER BY t.last_at DESC, t.id DESC LIMIT $3 OFFSET $4`, `SELECT count(*)::int AS n FROM open_index.topics t WHERE ${mine}`, [who, opts.space ?? null]];
	const [questions, total] = await Promise.all([
		db.query<Topic>(list, [...args, start.limit, start.offset]).then((r) => r.rows),
		start.total ?? db.query<{ n: number }>(count, args).then((r) => r.rows[0].n),
	]);
	return { questions, ...pageInfo(start, total, questions.length) };
}

/** One question, without its posts; null when there is none, `who` cannot read its space, or it is not in `space`. */
export async function topic(db: Db, id: number, who: Reader, space?: string): Promise<Topic | null> {
	if (!Number.isSafeInteger(id)) return null;
	return (await db.query<Topic>(`${TOPIC} WHERE t.id = $1 AND ${READABLE('t.space_id', '$2')} AND ($3::text IS NULL OR t.space_id = $3)`, [id, who, space ?? null])).rows[0] ?? null;
}

type WithComments = Post & { comments: Post[] };

/** The records a thread's posts name, each once, in the order they were first named, with their titles. */
export async function namedRecords(db: Db, posts: Pick<Post, 'mentions'>[]): Promise<{ id: string; title: string }[]> {
	const ids = [...new Set(posts.flatMap((p) => p.mentions))];
	if (!ids.length) return [];
	const titles = new Map((await db.query<{ id: string; title: string }>('SELECT id, title FROM open_index.records WHERE id = ANY($1)', [ids])).rows.map((r) => [r.id, r.title]));
	return ids.filter((id) => titles.has(id)).map((id) => ({ id, title: titles.get(id)! }));
}

/** A question with its comments, then its answers (the accepted one first, then by score), each with its comments. */
export async function topicWithPosts(db: Db, id: number, who: Reader, space?: string) {
	const t = await topic(db, id, who, space);
	if (!t) return null;
	const posts = await thread(db, { topic: id });
	const under = (p: Post): WithComments => ({ ...p, comments: posts.filter((c) => c.parent === p.id) });
	const [question, ...rest] = posts.filter((p) => p.parent === null);
	const answers = rest.map((a) => ({ ...under(a), accepted: a.id === t.accepted_id }))
		.sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.score - a.score || a.id - b.id);
	return { ...t, question: under(question), answers };
}

/** A topic with all its posts in the order they were made, replies to replies included: how a space's page shows a
 * thread. Null when there is no such topic in `space` that `who` can read. */
export async function topicThread(db: Db, id: number, who: Reader, space: string) {
	const t = await topic(db, id, who, space);
	return t ? { ...t, posts: await thread(db, { topic: id }) } : null;
}

/** Votes on a post in a topic: 1 or -1, or 0 to take the vote back. Returns the post's new score. */
export async function votePost(db: Db, topicId: number, postId: number, voter: Voter, value: number, space?: string) {
	if (![1, -1, 0].includes(value)) throw new QueryError('value must be 1, -1 or 0', 'Send "value": 1 (up), -1 (down) or 0 (take it back).');
	const p = !await topic(db, topicId, voter.login, space) ? undefined
		: (await db.query<{ voter: string }>('SELECT voter FROM open_index.comments WHERE id = $1 AND topic_id = $2', [postId, topicId])).rows[0];
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
export async function accept(db: Db, topicId: number, postId: number, voter: Voter, space?: string) {
	const t = await topicWithPosts(db, topicId, voter.login, space);
	if (!t) throw new NotFoundError(`no topic ${topicId}`, 'Use a topic id from GET /api/v1/forum.');
	if (t.voter !== voter.login) throw new QueryError('only the asker can accept an answer', 'Vote on it instead.');
	if (!t.answers.some((a) => a.id === postId)) throw new QueryError(`post ${postId} is not an answer to this question`, 'Accept an id from answers[].');
	const next = t.accepted_id === postId ? null : postId;
	await db.query('UPDATE open_index.topics SET accepted_id = $1 WHERE id = $2', [next, topicId]);
	return { topic: topicId, accepted_id: next };
}

type Activity = { id: number; voter: string; agent: string; body: string; review: boolean; at: string;
	record_id: string | null; topic_id: number | null; title: string };

/** All public posts with the title they were posted under: newest first, or with since (a post id), the later ones
 * oldest first. It serves the forum's public feed (GET /api/v1/forum), so it reads as nobody signed in. */
export async function activity(db: Db, opts: { since?: number; limit?: number } = {}) {
	const limit = pageLimit(opts.limit, FORUM_PAGE);
	const since = Number.isSafeInteger(opts.since) ? opts.since : undefined;
	const posts = (await db.query<Activity>(
		`SELECT c.id::int, c.voter, c.agent, c.body, c.review, c.at, c.record_id, c.topic_id::int, coalesce(t.title, r.title) AS title
		 FROM open_index.comments c LEFT JOIN open_index.topics t ON t.id = c.topic_id LEFT JOIN open_index.records r ON r.id = c.record_id
		 WHERE ${POST_READABLE('NULL')} ${since === undefined ? 'ORDER BY c.id DESC LIMIT $1' : 'AND c.id > $2 ORDER BY c.id LIMIT $1'}`,
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
