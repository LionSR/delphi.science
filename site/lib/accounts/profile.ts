// A person's public activity, for /u/<login>: posts by type, MathOverflow-style, and record votes (already public on
// each record). Forum post votes stay private. Reads only rows that are already public.
import { reviewLogin } from './review.ts';
import { CodedError, QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { pageInfo, pageSize, pageStart, type PageRequest } from '#lib/paging.ts';
import type { FromSchema, Schemas } from '#lib/api/schema.ts';
import { recordPath } from '#lib/view.ts';

/** A profile's page size (lib/paging.ts). */
export const PROFILE_PAGE = pageSize('Items', 50, 20);

/** Post kinds, named as moderation names them (posts/comments.ts, posts/edit.ts): a topic's opening post is a question, a
 * reply to it an answer. The profile shows them as Topic and Reply. */
export const POST_KINDS = ['question', 'answer', 'comment', 'review'] as const;
export type PostKind = (typeof POST_KINDS)[number];
/** Profile tabs: all posts, one group of kinds (comments include record reviews), or record votes. */
export const POST_TABS = ['all', 'topics', 'replies', 'comments'] as const;
export const TABS = [...POST_TABS, 'votes'] as const;
export type Tab = (typeof TABS)[number];
type PostTab = (typeof POST_TABS)[number];
const TAB_KINDS: Record<Exclude<PostTab, 'all'>, PostKind[]> = { topics: ['question'], replies: ['answer'], comments: ['comment', 'review'] };
/** The tabs that each hold one group of post kinds; together they hold every post once. */
const KIND_TABS = TABS.filter((t): t is keyof typeof TAB_KINDS => t in TAB_KINDS);

// The types are the API's schemas (lib/api/openapi.ts), so what this module returns is what the API documents.
export type ProfilePost = FromSchema<Schemas['ActivityPost']>;
export type ProfileVote = FromSchema<Schemas['ActivityVote']>;
/** A profile page: the counts, then one page (lib/paging.ts) of the tab's posts, or of its votes on the votes tab. */
export type Profile = FromSchema<Schemas['UserActivity']>;
type ProfileCounts = Profile['counts'];
type Row = {
	id: string; kind: PostKind; voter: string; agent: string; body: string; at: string | Date; title: string;
	record_id: string | null; topic_id: string | null; parent: string | null;
};
type VoteRow = { record_id: string; title: string; agent: string; value: 1 | -1 | null; emoji: string | null; note: string | null; at: string | Date };

const badLogin = () => new QueryError('Use a valid GitHub login.', 'Use 1–39 ASCII letters/digits or single internal hyphens; account paths and display names are not handles.');
/** The database could not answer; the API reports it as 503. */
export class ProfileUnavailable extends CodedError {}
const unavailable = () => new ProfileUnavailable(503, 'unavailable', 'Public activity is temporarily unavailable.', 'Try this public activity page again later.');

export function normalizeProfileLogin(value: unknown): string {
	if (typeof value !== 'string') throw badLogin();
	// The plugin reviewers' demo account has a login no GitHub account can have (lib/accounts/review.ts), and a profile like anyone's.
	if (value.toLowerCase() === reviewLogin()) return value.toLowerCase();
	if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value) || value.includes('--')) throw badLogin();
	return value.toLowerCase();
}

// Only the fields the schema lists. Ids are read as text and returned as numbers.
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

// A login's public posts and the kind of each (the rule in posts/edit.ts, written in SQL). Only posts on a live record,
// or in a topic whose question exists; a reply counts only if its parent is in the same place.
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

// A slice of a login's list, as profile() pages it.
type Slice = { offset?: number; limit?: number };

/** A slice of a login's public posts, newest first: all of them, or one tab's kinds. */
export async function profileActivity(db: Db, handle: unknown, { tab = 'all', offset = 0, limit = PROFILE_PAGE.fallback }: Slice & { tab?: PostTab } = {}): Promise<ProfilePost[]> {
	const login = normalizeProfileLogin(handle);
	try {
		return (await db.query<Row>(`SELECT * FROM (${ACTIVITY}) a WHERE ($2::text[] IS NULL OR a.kind = ANY($2::text[]))
			ORDER BY a.pid DESC LIMIT $3 OFFSET $4`, [login, tab === 'all' ? null : TAB_KINDS[tab], limit, offset])).rows.map(toPost);
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

/** A slice of a login's votes on live records, newest first. */
export async function profileVotes(db: Db, handle: unknown, { offset = 0, limit = PROFILE_PAGE.fallback }: Slice = {}): Promise<ProfileVote[]> {
	const login = normalizeProfileLogin(handle);
	try {
		return (await db.query<VoteRow>(`SELECT v.record_id, r.title, v.agent, v.value, v.emoji, v.note, v.at ${VOTES}
			ORDER BY v.at DESC, v.record_id DESC LIMIT $2 OFFSET $3`, [login, limit, offset])).rows.map((v): ProfileVote => ({
			record_id: v.record_id, title: v.title, agent: v.agent, value: v.value, emoji: v.emoji, note: v.note,
			at: new Date(v.at).toISOString(), permalink: recordPath(v.record_id),
		}));
	} catch {
		throw unavailable();
	}
}

/** What /u/<login> and GET /api/v1/users/{login} show: the counts and one page (lib/paging.ts) of the chosen tab. */
export async function profile(db: Db, handle: unknown, options: PageRequest & { tab?: Tab } = {}): Promise<Profile> {
	const login = normalizeProfileLogin(handle);
	const tab = options.tab ?? 'all';
	const start = pageStart(options, PROFILE_PAGE);
	const [counts, list] = await Promise.all([
		profileCounts(db, login),
		tab === 'votes'
			? profileVotes(db, login, start).then((votes) => ({ tab, votes, count: votes.length }))
			: profileActivity(db, login, { ...start, tab }).then((posts) => ({ tab, posts, count: posts.length })),
	]);
	const { count, ...items } = list;
	const total = tab === 'all' ? KIND_TABS.reduce((n, t) => n + counts[t], 0) : counts[tab];
	return { login, counts, ...items, ...pageInfo(start, total, count) };
}
