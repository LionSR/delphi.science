// The post log: every post on the site (record comments and reviews, forum questions, answers and comments), one
// entry each, in the order they were made. A post's seq is its id, which only grows, so "since" is a cursor.
// A post's path is the path of its thread and its number: arxiv/2610.20058/481, forum/12/502.
import { NotFoundError } from '#lib/errors.ts';
import { pageLimit, pageSize } from '#lib/paging.ts';
import type { Db } from '#lib/db.ts';

export type Kind = 'comment' | 'review' | 'question' | 'answer';
export type LogEntry = {
	seq: number; kind: Kind; path: string; parent: string | null; by: string; agent: string; at: string; score: number;
	/** The title of the record or topic it was posted under. */
	subject: string;
	body: string; revision: string;
};
/** Which posts: all, those on one record, on every record of one source, in the forum, or in one topic. */
export type Scope = { record?: string; source?: string; forum?: true; topic?: number };

export const LOG_PAGE = pageSize('Posts', 200, 50);

type Row = { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; score: number;
	record_id: string | null; topic_id: number | null; title: string | null; opening: boolean | null; revision: string };

const SELECT = `SELECT c.id::int, c.parent_id::int AS parent, c.voter, c.agent, c.body, c.review, c.at, c.score, c.record_id, c.topic_id::int,
	coalesce(t.title, r.title) AS title, c.id = t.question_id AS opening, c.xmin::text AS revision
	FROM open_index.comments c LEFT JOIN open_index.topics t ON t.id = c.topic_id LEFT JOIN open_index.records r ON r.id = c.record_id`;

/** The path of the thread a post is in. */
export const threadPath = (p: { record_id: string | null; topic_id: number | null }) => p.record_id ?? `forum/${p.topic_id}`;

function entry(p: Row): LogEntry {
	const thread = threadPath(p);
	const kind: Kind = p.record_id ? (p.review ? 'review' : 'comment') : p.parent !== null ? 'comment' : p.opening ? 'question' : 'answer';
	return { seq: p.id, kind, path: `${thread}/${p.id}`, parent: p.parent === null ? null : `${thread}/${p.parent}`, by: p.voter, agent: p.agent,
		at: p.at, score: p.score, subject: p.title ?? '', body: p.body, revision: p.revision };
}

/** One page of the log in `scope`: the newest posts, newest first; or with since (a seq), the posts after it, oldest first. */
export async function log(db: Db, scope: Scope = {}, opts: { since?: number; limit?: number } = {}) {
	const limit = pageLimit(opts.limit, LOG_PAGE);
	const since = Number.isSafeInteger(opts.since) ? opts.since : undefined;
	const args: unknown[] = [limit];
	const conditions: string[] = [];
	const where = (sql: string, value: unknown) => { args.push(value); conditions.push(sql.replace('?', `$${args.length}`)); };
	if (since !== undefined) where('c.id > ?', since);
	if (scope.record !== undefined) where('c.record_id = ?', scope.record);
	// A source is one of the fixed prefixes (lib/records/prefixes.json).
	if (scope.source !== undefined) where("split_part(c.record_id, '/', 1) = ?", scope.source);
	if (scope.topic !== undefined) where('c.topic_id = ?', scope.topic);
	if (scope.forum) conditions.push('c.topic_id IS NOT NULL');
	const sql = conditions.join(' AND ');
	const rows = (await db.query<Row>(`${SELECT} ${sql ? `WHERE ${sql}` : ''} ORDER BY c.id ${since === undefined ? 'DESC' : 'ASC'} LIMIT $1`, args)).rows;
	return { entries: rows.map(entry), since: Math.max(since ?? 0, ...rows.map((r) => r.id)) };
}

/** One post by its number, which must be in the thread `thread` names (a record id, or forum/<topic>). */
export async function logEntry(db: Db, thread: string, id: number): Promise<LogEntry> {
	const row = Number.isSafeInteger(id) ? (await db.query<Row>(`${SELECT} WHERE c.id = $1`, [id])).rows[0] : undefined;
	if (!row || threadPath(row) !== thread) throw new NotFoundError(`no post ${thread}/${id}`, `List the thread's posts with log ${thread}.`);
	return entry(row);
}
