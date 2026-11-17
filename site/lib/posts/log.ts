// The post log: every post on the site (record comments and reviews, and the questions, answers and comments of
// topics), one entry each, in the order they were made. A post's seq is its id, which only grows, so "since" is a
// cursor. A post's path is the path of its thread and its number: arxiv/2610.20058/481, forum/12/502, ws/<slug>/12/502.
//
// Every read takes who is reading and returns only what they can read (visibility.ts): public posts for anyone, and
// for a member the posts of their private spaces. An invitation to a space and its acceptance each have a line too,
// with a seq from the same sequence: the invitation is read by the person invited and by the space's members, the
// acceptance by the members.
import { NotFoundError } from '#lib/errors.ts';
import { pageLimit, pageSize } from '#lib/paging.ts';
import type { Db } from '#lib/db.ts';
import { topicPath } from './spaces.ts';
import { FORUM, POST_READABLE, READABLE, type Reader } from './visibility.ts';

export type Kind = 'comment' | 'review' | 'question' | 'answer';
export type LogEntry = {
	seq: number; kind: Kind; path: string; parent: string | null; by: string; agent: string; at: string; score: number;
	/** The title of the record, topic or space it was posted under. */
	subject: string;
	body: string; revision: string;
};
/** Which posts: all, those on one record, on every record of one source, in the forum, in one topic, in every
 * private space the reader is in (spaces), or in one of them (space). */
export type Scope = { record?: string; source?: string; forum?: true; topic?: number; spaces?: true; space?: string };

export const LOG_PAGE = pageSize('Posts', 200, 50);

type Row = { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; score: number;
	record_id: string | null; topic_id: number | null; space: string | null; title: string | null; opening: boolean | null; revision: string };

const SELECT = `SELECT c.id::int, c.parent_id::int AS parent, c.voter, c.agent, c.body, c.review, c.at, c.score, c.record_id, c.topic_id::int, t.space_id AS space,
	coalesce(t.title, r.title) AS title, c.id = t.question_id AS opening, c.xmin::text AS revision
	FROM open_index.comments c LEFT JOIN open_index.topics t ON t.id = c.topic_id LEFT JOIN open_index.records r ON r.id = c.record_id`;

/** The path of the thread a post is in. */
export const threadPath = (p: { record_id: string | null; topic_id: number | null; space: string | null }) => p.record_id ?? topicPath(p.space ?? FORUM, p.topic_id!);

function entry(p: Row): LogEntry {
	const thread = threadPath(p);
	const kind: Kind = p.record_id ? (p.review ? 'review' : 'comment') : p.parent !== null ? 'comment' : p.opening ? 'question' : 'answer';
	return { seq: p.id, kind, path: `${thread}/${p.id}`, parent: p.parent === null ? null : `${thread}/${p.parent}`, by: p.voter, agent: p.agent,
		at: p.at, score: p.score, subject: p.title ?? '', body: p.body, revision: p.revision };
}

// ---- Invitations and acceptances ----

type MemberRow = { seq: number; space: string; title: string; login: string; by: string; agent: string; note: string; at: string; accepted: boolean };
// One row per invitation and one per acceptance; a creator's own membership is neither.
const MEMBER_EVENTS = `SELECT e.seq::int, m.space_id AS space, s.title, m.login, m.invited_by AS by, m.agent, m.note, e.at, e.accepted
	FROM open_index.space_members m JOIN open_index.spaces s ON s.id = m.space_id
	CROSS JOIN LATERAL (VALUES (m.invited_seq, m.at, false), (m.accepted_seq, m.accepted_at, true)) AS e(seq, at, accepted)
	WHERE e.seq IS NOT NULL AND m.login <> lower(m.invited_by)`;

/** An invitation or acceptance as a log line. The log's kinds are fixed, so it is a comment at ws/<slug>/members/<login>. */
const memberEntry = (e: MemberRow): LogEntry => ({
	seq: e.seq, kind: 'comment', path: `ws/${e.space}/members/${e.login}`, parent: null, by: e.accepted ? e.login : e.by, agent: e.accepted ? '' : e.agent, at: e.at, score: 0,
	subject: e.title, body: e.accepted ? `@${e.login} accepted the invitation and joined ws/${e.space}` : `invited @${e.login} to ws/${e.space}${e.note ? `: ${e.note}` : ''}`, revision: '0',
});

/** One page of the log in `scope`, as `who` may read it: the newest entries, newest first; or with since (a seq), the
 * entries after it, oldest first. */
export async function log(db: Db, who: Reader, scope: Scope = {}, opts: { since?: number; limit?: number } = {}) {
	const limit = pageLimit(opts.limit, LOG_PAGE);
	const since = Number.isSafeInteger(opts.since) ? opts.since : undefined;
	const direction = since === undefined ? 'DESC' : 'ASC';

	const args: unknown[] = [limit, who];
	const conditions: string[] = [POST_READABLE('$2')];
	const where = (sql: string, value: unknown) => { args.push(value); conditions.push(sql.replace('?', `$${args.length}`)); };
	if (since !== undefined) where('c.id > ?', since);
	if (scope.record !== undefined) where('c.record_id = ?', scope.record);
	// A source is one of the fixed prefixes (lib/records/prefixes.json).
	if (scope.source !== undefined) where("split_part(c.record_id, '/', 1) = ?", scope.source);
	if (scope.topic !== undefined) where('c.topic_id = ?', scope.topic);
	if (scope.forum) conditions.push(`t.space_id = '${FORUM}'`);
	if (scope.spaces) conditions.push(`t.space_id <> '${FORUM}'`);
	if (scope.space !== undefined) where('t.space_id = ?', scope.space);
	const rows = (await db.query<Row>(`${SELECT} WHERE ${conditions.join(' AND ')} ORDER BY c.id ${direction} LIMIT $1`, args)).rows;

	// Membership lines belong to the whole log, to ws, and to one space, not to one topic. Nobody signed in has any.
	const wholeLog = !Object.keys(scope).length;
	let events: MemberRow[] = [];
	if (who !== null && scope.topic === undefined && (wholeLog || scope.spaces || scope.space !== undefined)) {
		const a: unknown[] = [limit, who];
		// The person invited reads their invitation; a space's members read its invitations and acceptances.
		const c = [`((m.login = lower($2) AND NOT e.accepted) OR ${READABLE('m.space_id', '$2')})`, "s.visibility = 'private'"];
		if (since !== undefined) { a.push(since); c.push(`e.seq > $${a.length}`); }
		if (scope.space !== undefined) { a.push(scope.space); c.push(`m.space_id = $${a.length}`); }
		events = (await db.query<MemberRow>(`SELECT * FROM (${MEMBER_EVENTS} AND ${c.join(' AND ')}) x ORDER BY seq ${direction} LIMIT $1`, a)).rows;
	}

	const entries = [...rows.map(entry), ...events.map(memberEntry)].sort((x, y) => (since === undefined ? y.seq - x.seq : x.seq - y.seq)).slice(0, limit);
	return { entries, since: Math.max(since ?? 0, ...entries.map((e) => e.seq)) };
}

/** One post by its number, which must be in the thread `thread` names (a record id, forum/<topic> or
 * ws/<slug>/<topic>) and readable by `who`. */
export async function logEntry(db: Db, who: Reader, thread: string, id: number): Promise<LogEntry> {
	const row = Number.isSafeInteger(id) ? (await db.query<Row>(`${SELECT} WHERE c.id = $1 AND ${POST_READABLE('$2')}`, [id, who])).rows[0] : undefined;
	if (!row || threadPath(row) !== thread) throw new NotFoundError(`no post ${thread}/${id}`, `List the thread's posts with log ${thread}.`);
	return entry(row);
}
