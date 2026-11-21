// The log: what happened on the site, one entry each, in the order it happened. An entry is a record entering the
// index, or a post (a comment or review on a record, a forum question, answer or comment). Entries come from
// open_index.events (supabase/migrations/20261117130000_events.sql), whose seq only grows, so "since" is a cursor
// over records and posts together. A query narrows the log: the record query language (lib/records/query.ts) with
// the fields below added. A feed is the log with a query; an inbox is the log with to:@me.
//
// Every read of events goes through log() here, and visible() is the one condition on who may see an event: the
// visibility rule of lib/posts/visibility.ts. A post in a private space is an event only its members read; to
// everyone else, and to every feed, it is not there. An invitation to a space and its acceptance each have a line too,
// with a seq from the same sequence (open_index.space_members): the person invited reads the invitation, and the
// space's members read both.
import { CodedError, NotFoundError, QueryError } from '#lib/errors.ts';
import { pageLimit, pageSize } from '#lib/paging.ts';
import type { Db } from '#lib/db.ts';
import { Compiler, FIELDS, parse, type Leaf } from '#lib/records/query.ts';
import { OFFERS_OPTIONS, topicPath } from './spaces.ts';
import { FORUM, POST_READABLE, READABLE, type Reader } from './visibility.ts';

export const KINDS = ['record', 'question', 'answer', 'comment', 'review'] as const;
export type Kind = (typeof KINDS)[number];
export type LogEntry = {
	seq: number; kind: Kind; path: string; parent: string | null; by: string; agent: string; at: string; score: number;
	/** The title of the record, or of the record or topic a post is under. */
	subject: string;
	/** A post's text; a record's abstract. */
	body: string; revision: string;
	/** The ids of the records a post names. */
	mentions: string[];
};
/** Which entries: all, those of one record, of every record of one source, in the forum, in one topic, in every
 * private space the reader is in (spaces), or in one of them (space). */
export type Scope = { record?: string; source?: string; forum?: true; topic?: number; spaces?: true; space?: string };

export const LOG_PAGE = pageSize('Entries', 200, 50);

/** Thrown when a query names the caller (to:@me) and nobody is signed in. */
export class NeedsReader extends CodedError {
	constructor(term: string) {
		super(401, 'sign_in', `${term} needs a signed-in caller`, 'Sign in, or name the person: to:@<GitHub login>.');
	}
}

// ---- The query ----

/** The fields the log adds to the record query language, as the docs describe them (OpenAPI, /llms.txt, the CLI). */
export const LOG_FIELDS: Record<string, string> = {
	kind: `what happened: ${KINDS.join(', ')} (a record entering the index, or a post of that kind)`,
	re: 'posts about one record, on it or naming it: re:arxiv/2610.20058',
	to: 'posts addressed to a person, by others: replies to their posts, and answers and comments in topics they started. to:@me is the caller\'s inbox and needs sign-in',
	by: 'posts by a person: by:@login, or by:@me',
};
export const LOG_QUERY_HELP = `The query language of search's q, plus ${Object.entries(LOG_FIELDS).map(([f, about]) => `${f}: ${about}`).join('; ')}. A record term (cat:quant-ph, source:arxiv, is:formalized, a word) matches a new record that fits it, and a post when the record it is on, or one it names, fits it; a bare word also matches a post's own text and its topic's title. Left out: everything.`;
/** What the query also takes, said in /llms.txt, the skill and the saved-queries page. It is kept out of LOG_FIELDS,
 * which is the text of the log operation's description: that text is what the plugin directories reviewed. */
export const LOG_ALSO: Record<string, string> = {
	'is:open, is:answered': 'posts in a topic whose question has no accepted answer yet, or has one. With kind:question, the questions themselves',
	'to: (questions)': 'to:@login also holds each question put to a private space that person is in: a post that starts with an options line, their own agents\' included. Only the space\'s members read these',
};
export const LOG_QUERY_GUIDE = Object.entries(LOG_FIELDS).map(([f, about]) => `- ${f}: ${about}`).join('\n');

const POST = 'e.post_id IS NOT NULL';
// The same term over a record a post names (open_index.mentions). Inside, r is that record.
const mentioned = (sql: string) => `EXISTS (SELECT 1 FROM open_index.mentions m JOIN open_index.records r ON r.id = m.record_id WHERE m.comment_id = e.post_id AND ${sql})`;

/** Compiles a query over events e, joined to the post c, its topic t and the record r the event is on. */
class EventCompiler extends Compiler {
	fields = [...FIELDS, ...Object.keys(LOG_FIELDS)].sort();
	reader: Reader;
	constructor(reader: Reader) { super(); this.reader = reader; }

	/** A login as written (@login, login, any case), lowercased; @me is the caller. */
	private login(field: string, value: string) {
		const name = value.replace(/^@/, '').toLowerCase();
		if (!name) throw new QueryError(`${field}: needs a GitHub login`, `Write ${field}:@login, or ${field}:@me for yourself.`);
		if (name !== 'me') return this.p(name);
		if (!this.reader) throw new NeedsReader(`${field}:@me`);
		return this.p(this.reader.toLowerCase());
	}

	leaf(t: Leaf, positive: boolean): string {
		const { field: f, value: v } = t;
		if (f === 'kind') {
			const kind = v.toLowerCase();
			if (!(KINDS as readonly string[]).includes(kind)) throw new QueryError(`unknown kind:${v}`, `Use ${KINDS.map((k) => 'kind:' + k).join(', ')}.`);
			// A record is the event with no post (a check constraint says so). Written this way, NOT kind:record is
			// "post_id IS NOT NULL" to the planner, which the index of posts alone (events_posts) needs.
			return kind === 'record' ? 'e.post_id IS NULL' : `(${POST} AND e.kind = ${this.p(kind)})`;
		}
		if (f === 'by') return `(${POST} AND lower(e.voter) = ${this.login(f, v)})`;
		if (f === 'to') {
			const who = this.login(f, v);
			// Addressed to them by someone else: a reply to their post, or a post in a topic they started.
			const addressed = `(lower(e.voter) <> ${who} AND (lower(t.voter) = ${who}
				OR EXISTS (SELECT 1 FROM open_index.comments p WHERE p.id = c.parent_id AND lower(p.voter) = ${who})))`;
			// Or put to them: a post that offers options in a private space they are in. An agent posts as its owner, so
			// "by someone else" would leave out the very question an agent asks its own owner; what is left out here
			// is only what the person wrote themself. visible() still decides who reads it: the space's members.
			const asked = `(${OFFERS_OPTIONS('c.body')} AND NOT (lower(e.voter) = ${who} AND c.agent = '')
				AND EXISTS (SELECT 1 FROM open_index.space_members m JOIN open_index.spaces s ON s.id = m.space_id
					WHERE m.space_id = t.space_id AND m.login = ${who} AND m.accepted_at IS NOT NULL AND s.visibility = 'private'))`;
			return `(${POST} AND (${addressed} OR ${asked}))`;
		}
		// The state of the topic a post is in. A term about a topic is true of every post in it, as a term about a
		// record is true of every post on it.
		if (f === 'is' && /^(open|answered)$/i.test(v)) return `(e.topic_id IS NOT NULL AND t.accepted_id IS ${v.toLowerCase() === 'open' ? '' : 'NOT '}NULL)`;
		if (f === 're') {
			if (!v) throw new QueryError('re: needs a record id', 'Write re:<record id>, e.g. re:arxiv/2610.20058.');
			const id = this.p(v);
			return `(${POST} AND (e.record_id = ${id} OR EXISTS (SELECT 1 FROM open_index.mentions m WHERE m.comment_id = e.post_id AND m.record_id = ${id})))`;
		}
		// A record term: true of the record the event is on, or of a record the post names.
		const text = this.text(t, positive);
		if (text) {
			const about = this.textMatch(text);
			// A bare word is also looked for in the post itself and in its topic's title.
			const own = text.column === 'all_tsv' ? ` OR c.tsv @@ ${text.tsq} OR t.tsv @@ ${text.tsq}` : '';
			return `((r.id IS NOT NULL AND ${about}) OR ${mentioned(about)}${own})`;
		}
		const about = super.leaf(t, positive);
		return `((r.id IS NOT NULL AND ${about}) OR ${mentioned(about)})`;
	}
}

/** Who may see an event, as SQL over e and its topic t, with the reader's login in `param` ($n): a record and a post
 * on a record are public, and a post in a topic is seen by whoever can read the topic's space (visibility.ts). The
 * rule is here, and only here. */
const visible = (param: string) => `(e.topic_id IS NULL OR ${READABLE('t.space_id', param)})`;

// ---- Reading ----

type Row = { seq: number; kind: Kind; at: string; voter: string; record_id: string | null; topic_id: number | null; post_id: number | null; space: string | null;
	parent: number | null; agent: string | null; score: number | null; title: string | null; body: string | null; revision: string | null; mentions: string[] };

/** The path of the thread a post is in: a record's id, forum/<topic>, or ws/<slug>/<topic>. */
export const threadPath = (p: { record_id: string | null; topic_id: number | null; space: string | null }) => p.record_id ?? topicPath(p.space ?? FORUM, p.topic_id!);

// The path is built here from the topic's space, not read from events.path, which knows the forum's paths only.
const entry = (e: Row): LogEntry => ({
	seq: e.seq, kind: e.kind, path: e.post_id === null ? e.record_id! : `${threadPath(e)}/${e.post_id}`, parent: e.parent === null ? null : `${threadPath(e)}/${e.parent}`, by: e.voter, agent: e.agent ?? '',
	at: e.at, score: e.score ?? 0, subject: e.title ?? '', body: e.body ?? '', revision: e.revision ?? '', mentions: e.mentions,
});

// An event whose post or record is gone is not shown.
const EVENTS = `SELECT e.seq::int, e.kind, e.at, e.voter, e.record_id, e.topic_id::int, e.post_id::int, t.space_id AS space, c.parent_id::int AS parent, c.agent,
		coalesce(c.score, r.score) AS score, coalesce(t.title, r.title) AS title, coalesce(c.body, r.abstract) AS body, c.xmin::text AS revision,
		ARRAY(SELECT m.record_id FROM open_index.mentions m WHERE m.comment_id = e.post_id ORDER BY m.record_id) AS mentions
	FROM open_index.events e
	LEFT JOIN open_index.comments c ON c.id = e.post_id
	LEFT JOIN open_index.topics t ON t.id = e.topic_id
	LEFT JOIN open_index.records r ON r.id = e.record_id
	WHERE (c.id IS NOT NULL OR (e.post_id IS NULL AND r.id IS NOT NULL))`;

/** Checks one query as log would read it for `reader`, without running it. Throws the QueryError log would throw. */
export function checkQuery(q: string, reader: Reader = null): void {
	new EventCompiler(reader).tree(parse(q));
}

/** The largest seq in the log, 0 when it is empty: where a reader who has seen everything stands. A number only, the
 * same for every reader, so it says nothing about what any of them may see. */
export async function head(db: Db): Promise<number> {
	// Invitations and acceptances occupy the same log sequence without an events row. Read committed rows,
	// not the sequence's last_value: an allocated value need not belong to a visible log entry yet.
	return (await db.query<{ seq: number }>(`SELECT greatest(0,
		(SELECT max(seq) FROM open_index.events),
		(SELECT max(invited_seq) FROM open_index.space_members),
		(SELECT max(accepted_seq) FROM open_index.space_members))::int AS seq`)).rows[0].seq;
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
	subject: e.title, body: e.accepted ? `@${e.login} accepted the invitation and joined ws/${e.space}` : `invited @${e.login} to ws/${e.space}${e.note ? `: ${e.note}` : ''}`, revision: '0', mentions: [],
});

export type LogOptions = { since?: number; limit?: number; q?: string;
	/** Read as nobody, while @me in a query still names `who`: how the MCP server reads while spaces are closed to it. */
	publicOnly?: boolean;
	/** Saved queries (lib/accounts/queries.ts): only entries that match at least one of them. Each is parsed on its own
	 * and the whole is one condition beside q, so nothing written in q, an OR included, reaches outside them. An empty
	 * list matches nothing. It narrows what `who` may see and never widens it. */
	any?: string[];
	/** Only entries before this seq: the next page of a newest-first listing (the web's My feed). Not with since. */
	before?: number };

/** One page of the log in `scope`, as `who` may read it, narrowed by a query: the newest entries, newest first; or
 * with since (a seq), the entries after it, oldest first. The reply's since is the largest seq seen, to send next time. */
export async function log(db: Db, who: Reader, scope: Scope = {}, opts: LogOptions = {}) {
	const limit = pageLimit(opts.limit, LOG_PAGE);
	const since = Number.isSafeInteger(opts.since) ? opts.since : undefined;
	const direction = since === undefined ? 'DESC' : 'ASC';
	const c = new EventCompiler(who);
	const sees = opts.publicOnly ? null : who;
	// First in the list, and nothing below loosens it.
	const conditions = [visible(c.p(sees))];
	if (since !== undefined) conditions.push(`e.seq > ${c.p(since)}`);
	else if (Number.isSafeInteger(opts.before)) conditions.push(`e.seq < ${c.p(opts.before)}`);
	// One record's log is its thread: the posts on it. That the record itself came in is not news under its own path.
	if (scope.record !== undefined) conditions.push(`e.record_id = ${c.p(scope.record)} AND ${POST}`);
	// A source is one of the fixed prefixes (lib/records/prefixes.json).
	if (scope.source !== undefined) conditions.push(`split_part(e.record_id, '/', 1) = ${c.p(scope.source)}`);
	if (scope.topic !== undefined) conditions.push(`e.topic_id = ${c.p(scope.topic)}`);
	if (scope.forum) conditions.push(`t.space_id = '${FORUM}'`);
	if (scope.spaces) conditions.push(`t.space_id <> '${FORUM}'`);
	if (scope.space !== undefined) conditions.push(`t.space_id = ${c.p(scope.space)}`);
	const q = opts.q?.trim();
	if (opts.any) conditions.push(opts.any.length ? `(${opts.any.map((line) => `(${c.tree(parse(line))})`).join(' OR ')})` : 'false');
	if (q) conditions.push(`(${c.tree(parse(q))})`);
	// What was asked for, as far as membership lines go (below). Saved queries count as a query: one saved line alone
	// is that query, as `delphi log -f` sends it; several, or a search within them, are a larger query.
	const asked = opts.any ? (opts.any.length === 1 && !q ? opts.any[0].trim() : '(saved queries)') : q;
	const rows = (await db.query<Row>(
		`${EVENTS} AND ${conditions.join(' AND ')} ORDER BY e.seq ${direction} LIMIT ${c.p(limit)}`, c.params)).rows;

	// Membership lines belong to the whole log, to ws, and to one space, not to one topic. A query is about records and
	// posts and leaves them out, with one exception: the inbox. When the whole query is to:@login (or to:@me), an
	// invitation sent to that person is addressed to them, and so is the acceptance of one they sent. A to: inside a
	// larger query (OR, NOT, other terms) is decided over posts only. Nobody signed in has any of these lines.
	const wholeLog = !Object.keys(scope).length;
	const named = asked?.match(/^to:@?([a-z0-9][a-z0-9_-]*)$/i)?.[1].toLowerCase();
	const to = named === 'me' ? who?.toLowerCase() : named;
	let events: MemberRow[] = [];
	if (sees !== null && (!asked || to) && scope.topic === undefined && (wholeLog || scope.spaces || scope.space !== undefined)) {
		const a: unknown[] = [limit, sees];
		// The person invited reads their invitation; a space's members read its invitations and acceptances.
		const m = [`((m.login = lower($2) AND NOT e.accepted) OR ${READABLE('m.space_id', '$2')})`, "s.visibility = 'private'"];
		if (since !== undefined) { a.push(since); m.push(`e.seq > $${a.length}`); }
		else if (Number.isSafeInteger(opts.before)) { a.push(opts.before); m.push(`e.seq < $${a.length}`); }
		if (scope.space !== undefined) { a.push(scope.space); m.push(`m.space_id = $${a.length}`); }
		if (to) { a.push(to); m.push(`((NOT e.accepted AND m.login = $${a.length}) OR (e.accepted AND lower(m.invited_by) = $${a.length}))`); }
		events = (await db.query<MemberRow>(`SELECT * FROM (${MEMBER_EVENTS} AND ${m.join(' AND ')}) x ORDER BY seq ${direction} LIMIT $1`, a)).rows;
	}

	const entries = [...rows.map(entry), ...events.map(memberEntry)].sort((x, y) => (since === undefined ? y.seq - x.seq : x.seq - y.seq)).slice(0, limit);
	return { entries, since: Math.max(since ?? 0, ...entries.map((e) => e.seq)) };
}

type PostRow = { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; score: number;
	record_id: string | null; topic_id: number | null; space: string | null; title: string | null; opening: boolean | null; revision: string };

/** One post by its number, which must be in the thread `thread` names (a record id, forum/<topic> or
 * ws/<slug>/<topic>) and readable by `who`. It is read from the post itself, not from the log, so it has no seq. */
export async function logEntry(db: Db, who: Reader, thread: string, id: number): Promise<Omit<LogEntry, 'seq' | 'mentions'>> {
	const p = Number.isSafeInteger(id) ? (await db.query<PostRow>(
		`SELECT c.id::int, c.parent_id::int AS parent, c.voter, c.agent, c.body, c.review, c.at, c.score, c.record_id, c.topic_id::int, t.space_id AS space,
			coalesce(t.title, r.title) AS title, c.id = t.question_id AS opening, c.xmin::text AS revision
		 FROM open_index.comments c LEFT JOIN open_index.topics t ON t.id = c.topic_id LEFT JOIN open_index.records r ON r.id = c.record_id WHERE c.id = $1 AND ${POST_READABLE('$2')}`, [id, who])).rows[0] : undefined;
	if (!p || threadPath(p) !== thread) throw new NotFoundError(`no post ${thread}/${id}`, `List the thread's posts with log ${thread}.`);
	const kind: Kind = p.record_id ? (p.review ? 'review' : 'comment') : p.parent !== null ? 'comment' : p.opening ? 'question' : 'answer';
	return { kind, path: `${thread}/${p.id}`, parent: p.parent === null ? null : `${thread}/${p.parent}`, by: p.voter, agent: p.agent,
		at: p.at, score: p.score, subject: p.title ?? '', body: p.body, revision: p.revision };
}
