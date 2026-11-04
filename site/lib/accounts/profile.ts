// A person's public activity, for /u/<login>: posts by type, MathOverflow-style, and record votes (already public on
// each record). Forum post votes stay private. Reads only rows that are already public.
import { QueryError } from '../errors.ts';
import type { Db } from '../db.ts';
import { recordPath } from '../view.ts';

export const DEFAULT_PROFILE_LIMIT = 20;
export const MAX_PROFILE_LIMIT = 50;

/** Post kinds, named as moderation names them (posts/comments.ts, posts/edit.ts): a topic's opening post is a question, a
 * reply to it an answer. The profile shows them as Topic and Reply. */
export const POST_KINDS = ['question', 'answer', 'comment', 'review'] as const;
export type PostKind = (typeof POST_KINDS)[number];
/** Profile tabs: all posts, one group of kinds (comments include record reviews), or record votes. */
export const TABS = ['all', 'topics', 'replies', 'comments', 'votes'] as const;
export type Tab = (typeof TABS)[number];
type PostTab = Exclude<Tab, 'votes'>;
const TAB_KINDS: Record<Exclude<PostTab, 'all'>, PostKind[]> = { topics: ['question'], replies: ['answer'], comments: ['comment', 'review'] };

export type ProfilePost = {
	id: number; kind: PostKind; voter: string; agent: string; body: string; at: string; title: string;
	record_id?: string; topic_id?: number; parent?: number; permalink: string;
};
export type ProfileVote = { record_id: string; title: string; agent: string; value: 1 | -1 | null; emoji: string | null; note: string | null; at: string; permalink: string };
type ProfileActivity = { login: string; posts: ProfilePost[]; next_cursor: string | null };
type ProfileVotes = { login: string; votes: ProfileVote[]; next_cursor: string | null };
type ProfileCounts = Record<Exclude<Tab, 'all'>, number>;
/** A profile page: the counts, then the tab's posts, or its votes on the votes tab. */
export type Profile = { login: string; tab: Tab; counts: ProfileCounts; posts?: ProfilePost[]; votes?: ProfileVote[]; next_cursor: string | null };
type Row = {
	id: string; kind: PostKind; voter: string; agent: string; body: string; at: string | Date; title: string;
	record_id: string | null; topic_id: string | null; parent: string | null;
};
type VoteRow = { record_id: string; title: string; agent: string; value: 1 | -1 | null; emoji: string | null; note: string | null; at: string | Date; at_key: string };

const badLogin = () => new QueryError('Use a valid GitHub login.', 'Use 1–39 ASCII letters/digits or single internal hyphens; account paths and display names are not handles.');
const badCursor = () => new QueryError('The public-activity cursor is invalid for this handle.', 'Pass this handle’s next_cursor unchanged, or start from its first page.');
/** The database could not answer; the API reports it as 503. */
export class ProfileUnavailable extends QueryError {}
const unavailable = () => new ProfileUnavailable('Public activity is temporarily unavailable.', 'Try this public activity page again later.');

export function normalizeProfileLogin(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value) || value.includes('--')) throw badLogin();
	return value.toLowerCase();
}

const encode = (login: string, payload: object) => Buffer.from(JSON.stringify({ v: 1, login, ...payload })).toString('base64url');

/** A cursor's payload. Only a cursor this module issued for this login is accepted: re-encoding the payload must
 * reproduce it exactly, which also pins v and login. */
function decode<T extends object>(cursor: string | undefined | null, login: string, valid: (p: Record<string, unknown>) => p is T & Record<string, unknown>): T | undefined {
	if (cursor === undefined || cursor === null) return undefined;
	if (typeof cursor !== 'string' || !cursor || cursor.length > 1024 || !/^[a-z\d_-]+$/i.test(cursor)) throw badCursor();
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(cursor, 'base64url')));
	} catch {
		throw badCursor();
	}
	const { v, login: owner, ...payload } = parsed ?? {};
	if (v !== 1 || owner !== login || !valid(payload) || encode(login, payload) !== cursor) throw badCursor();
	return payload;
}
const postCursor = (p: Record<string, unknown>): p is { before: number } => Number.isSafeInteger(p.before) && (p.before as number) >= 1;
// The database's own timestamp text, so microseconds survive the round trip.
const voteCursor = (p: Record<string, unknown>): p is { at: string; record: string } =>
	typeof p.at === 'string' && typeof p.record === 'string' && /^\d{4}-\d\d-\d\d [\d:.]+[+-]\d\d(:\d\d)?$/.test(p.at);

// The listed fields only. Ids are read as text and shown as numbers.
function toPost(row: Row): ProfilePost {
	const id = Number(row.id), topic = row.topic_id === null ? undefined : Number(row.topic_id);
	return {
		id, kind: row.kind, voter: row.voter, agent: row.agent, body: row.body, at: new Date(row.at).toISOString(), title: row.title,
		...(row.record_id === null ? {} : { record_id: row.record_id }),
		...(topic === undefined ? {} : { topic_id: topic }),
		...(row.parent === null ? {} : { parent: Number(row.parent) }),
		permalink: row.record_id === null ? `/forum/${topic}#p${id}` : `${recordPath(row.record_id)}#p${id}`,
	};
}

// A login's public posts with their kind (the rule in posts/edit.ts, in SQL). Posts on a live record, or in a topic whose question exists; replies only to a
// parent in the same place.
const ACTIVITY = `SELECT c.id AS pid, c.id::text AS id, c.voter, c.agent, c.body, c.at,
		c.record_id, c.topic_id::text AS topic_id, c.parent_id::text AS parent, coalesce(r.title, t.title) AS title,
		CASE WHEN c.record_id IS NOT NULL THEN CASE WHEN c.review THEN 'review' ELSE 'comment' END
			WHEN c.parent_id IS NOT NULL THEN 'comment' WHEN c.id = t.question_id THEN 'question' ELSE 'answer' END AS kind
	FROM open_index.comments c
	LEFT JOIN open_index.records r ON r.id = c.record_id AND NOT r.gone
	LEFT JOIN open_index.topics t ON t.id = c.topic_id
	LEFT JOIN open_index.comments p ON p.id = c.parent_id AND p.record_id IS NOT DISTINCT FROM c.record_id AND p.topic_id IS NOT DISTINCT FROM c.topic_id
	WHERE lower(c.voter) = $1
		AND ((c.record_id IS NOT NULL AND c.topic_id IS NULL AND r.id IS NOT NULL)
			OR (c.topic_id IS NOT NULL AND c.record_id IS NULL AND t.id IS NOT NULL
				AND EXISTS (SELECT 1 FROM open_index.comments q WHERE q.topic_id = c.topic_id AND q.parent_id IS NULL AND q.record_id IS NULL)))
		AND (c.parent_id IS NULL OR p.id IS NOT NULL)`;
const VOTES = `FROM open_index.votes v JOIN open_index.records r ON r.id = v.record_id AND NOT r.gone WHERE lower(v.voter) = $1`;

function checkLimit(limit: number) {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PROFILE_LIMIT) {
		throw new QueryError(`Activity limit must be from 1 to ${MAX_PROFILE_LIMIT}.`, `Use a whole-number limit, or omit it for ${DEFAULT_PROFILE_LIMIT} public posts.`);
	}
}

/** One page of a login's public posts, newest first: all of them, or one tab's kinds. */
export async function profileActivity(db: Db, handle: unknown, options: { limit?: number; cursor?: string | null; tab?: PostTab } = {}): Promise<ProfileActivity> {
	const login = normalizeProfileLogin(handle);
	const limit = options.limit ?? DEFAULT_PROFILE_LIMIT;
	checkLimit(limit);
	const before = decode(options.cursor, login, postCursor)?.before;
	const tab = options.tab ?? 'all';
	const kinds = tab === 'all' ? null : TAB_KINDS[tab];
	try {
		const rows = (await db.query<Row>(`SELECT * FROM (${ACTIVITY}) a
			WHERE ($2::bigint IS NULL OR a.pid < $2::bigint) AND ($4::text[] IS NULL OR a.kind = ANY($4::text[]))
			ORDER BY a.pid DESC LIMIT $3`, [login, before ?? null, limit + 1, kinds])).rows;
		const posts = rows.slice(0, limit).map(toPost);
		return { login, posts, next_cursor: rows.length > limit ? encode(login, { before: posts.at(-1)!.id }) : null };
	} catch {
		throw unavailable();
	}
}

/** How many public posts of each kind, and record votes, a login has. */
export async function profileCounts(db: Db, handle: unknown): Promise<ProfileCounts> {
	const login = normalizeProfileLogin(handle);
	try {
		// One pass over the activity, counting each tab's kinds.
		const row = (await db.query<Record<string, string | number>>(`SELECT
				count(*) FILTER (WHERE a.kind = ANY($2::text[])) AS topics,
				count(*) FILTER (WHERE a.kind = ANY($3::text[])) AS replies,
				count(*) FILTER (WHERE a.kind = ANY($4::text[])) AS comments,
				(SELECT count(*) ${VOTES}) AS votes
			FROM (${ACTIVITY}) a`, [login, TAB_KINDS.topics, TAB_KINDS.replies, TAB_KINDS.comments])).rows[0];
		return { topics: Number(row.topics), replies: Number(row.replies), comments: Number(row.comments), votes: Number(row.votes) };
	} catch {
		throw unavailable();
	}
}

/** One page of a login's votes on live records, newest first. */
export async function profileVotes(db: Db, handle: unknown, options: { limit?: number; cursor?: string | null } = {}): Promise<ProfileVotes> {
	const login = normalizeProfileLogin(handle);
	const limit = options.limit ?? DEFAULT_PROFILE_LIMIT;
	checkLimit(limit);
	const after = decode(options.cursor, login, voteCursor);
	try {
		const rows = (await db.query<VoteRow>(
			`SELECT v.record_id, r.title, v.agent, v.value, v.emoji, v.note, v.at, v.at::text AS at_key ${VOTES}
				AND ($2::timestamptz IS NULL OR (v.at, v.record_id) < ($2::timestamptz, $3::text))
			ORDER BY v.at DESC, v.record_id DESC LIMIT $4`, [login, after?.at ?? null, after?.record ?? null, limit + 1])).rows;
		const votes = rows.slice(0, limit).map((v): ProfileVote => ({
			record_id: v.record_id, title: v.title, agent: v.agent, value: v.value, emoji: v.emoji, note: v.note,
			at: new Date(v.at).toISOString(), permalink: recordPath(v.record_id),
		}));
		const last = rows[limit - 1];
		return { login, votes, next_cursor: rows.length > limit ? encode(login, { at: last.at_key, record: last.record_id }) : null };
	} catch {
		throw unavailable();
	}
}

/** What /u/<login> and GET /api/v1/users/{login} show: the counts and one page of the chosen tab. */
export async function profile(db: Db, handle: unknown, options: { tab?: Tab; cursor?: string | null; limit?: number } = {}): Promise<Profile> {
	const login = normalizeProfileLogin(handle);
	const tab = options.tab ?? 'all';
	const counts = await profileCounts(db, login);
	if (tab === 'votes') {
		const { votes, next_cursor } = await profileVotes(db, login, options);
		return { login, tab, counts, votes, next_cursor };
	}
	const { posts, next_cursor } = await profileActivity(db, login, { ...options, tab });
	return { login, tab, counts, posts, next_cursor };
}
