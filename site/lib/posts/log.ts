// The log: what happened on the site, one entry each, in the order it happened. An entry is a record entering the
// index, or a post (a comment or review on a record, a forum question, answer or comment). Entries come from
// open_index.events (supabase/migrations/20261117130000_events.sql), whose seq only grows, so "since" is a cursor
// over records and posts together. A query narrows the log: the record query language (lib/records/query.ts) with
// the fields below added. A feed is the log with a query; an inbox is the log with to:@me.
//
// Every read of events goes through log() here, so a rule about who may see what has one place to go: visible().
import { CodedError, NotFoundError, QueryError } from '#lib/errors.ts';
import { pageLimit, pageSize } from '#lib/paging.ts';
import type { Db } from '#lib/db.ts';
import { Compiler, FIELDS, parse, type Leaf } from '#lib/records/query.ts';

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
/** Which entries: all, those of one record, of every record of one source, in the forum, or in one topic. */
export type Scope = { record?: string; source?: string; forum?: true; topic?: number };
/** Who is asking: null for nobody (a reader, a feed). */
export type Reader = { login: string } | null;

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
		return this.p(this.reader.login.toLowerCase());
	}

	leaf(t: Leaf, positive: boolean): string {
		const { field: f, value: v } = t;
		if (f === 'kind') {
			const kind = v.toLowerCase();
			if (!(KINDS as readonly string[]).includes(kind)) throw new QueryError(`unknown kind:${v}`, `Use ${KINDS.map((k) => 'kind:' + k).join(', ')}.`);
			return kind === 'record' ? `e.kind = ${this.p(kind)}` : `(${POST} AND e.kind = ${this.p(kind)})`;
		}
		if (f === 'by') return `(${POST} AND lower(e.voter) = ${this.login(f, v)})`;
		if (f === 'to') {
			const who = this.login(f, v);
			return `(${POST} AND lower(e.voter) <> ${who} AND (lower(t.voter) = ${who}
				OR EXISTS (SELECT 1 FROM open_index.comments p WHERE p.id = c.parent_id AND lower(p.voter) = ${who})))`;
		}
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

/** Who may see an event, as SQL over e (and c, t, r). Everything on the site is public today; the rule for private
 * spaces goes here, and only here. */
const visible = (_reader: Reader) => 'true';

// ---- Reading ----

type Row = { seq: number; kind: Kind; path: string; at: string; voter: string; record_id: string | null; topic_id: number | null;
	parent: number | null; agent: string | null; score: number | null; title: string | null; body: string | null; revision: string | null; mentions: string[] };

/** The path of the thread a post is in. */
export const threadPath = (p: { record_id: string | null; topic_id: number | null }) => p.record_id ?? `forum/${p.topic_id}`;

const entry = (e: Row): LogEntry => ({
	seq: e.seq, kind: e.kind, path: e.path, parent: e.parent === null ? null : `${threadPath(e)}/${e.parent}`, by: e.voter, agent: e.agent ?? '',
	at: e.at, score: e.score ?? 0, subject: e.title ?? '', body: e.body ?? '', revision: e.revision ?? '', mentions: e.mentions,
});

// An event whose post or record is gone is not shown.
const EVENTS = `SELECT e.seq::int, e.kind, e.path, e.at, e.voter, e.record_id, e.topic_id::int, c.parent_id::int AS parent, c.agent,
		coalesce(c.score, r.score) AS score, coalesce(t.title, r.title) AS title, coalesce(c.body, r.abstract) AS body, c.xmin::text AS revision,
		ARRAY(SELECT m.record_id FROM open_index.mentions m WHERE m.comment_id = e.post_id ORDER BY m.record_id) AS mentions
	FROM open_index.events e
	LEFT JOIN open_index.comments c ON c.id = e.post_id
	LEFT JOIN open_index.topics t ON t.id = e.topic_id
	LEFT JOIN open_index.records r ON r.id = e.record_id
	WHERE (c.id IS NOT NULL OR (e.post_id IS NULL AND r.id IS NOT NULL))`;

export type LogOptions = { since?: number; limit?: number; q?: string; reader?: Reader };

/** One page of the log in `scope`, narrowed by a query: the newest entries, newest first; or with since (a seq), the
 * entries after it, oldest first. The reply's since is the largest seq seen, to send next time. */
export async function log(db: Db, scope: Scope = {}, opts: LogOptions = {}) {
	const limit = pageLimit(opts.limit, LOG_PAGE);
	const since = Number.isSafeInteger(opts.since) ? opts.since : undefined;
	const reader = opts.reader ?? null;
	const c = new EventCompiler(reader);
	const conditions = [visible(reader)];
	if (since !== undefined) conditions.push(`e.seq > ${c.p(since)}`);
	// One record's log is its thread: the posts on it. That the record itself came in is not news under its own path.
	if (scope.record !== undefined) conditions.push(`e.record_id = ${c.p(scope.record)} AND ${POST}`);
	// A source is one of the fixed prefixes (lib/records/prefixes.json).
	if (scope.source !== undefined) conditions.push(`split_part(e.record_id, '/', 1) = ${c.p(scope.source)}`);
	if (scope.topic !== undefined) conditions.push(`e.topic_id = ${c.p(scope.topic)}`);
	if (scope.forum) conditions.push('e.topic_id IS NOT NULL');
	if (opts.q?.trim()) conditions.push(c.tree(parse(opts.q)));
	const rows = (await db.query<Row>(
		`${EVENTS} AND ${conditions.join(' AND ')} ORDER BY e.seq ${since === undefined ? 'DESC' : 'ASC'} LIMIT ${c.p(limit)}`, c.params)).rows;
	return { entries: rows.map(entry), since: Math.max(since ?? 0, ...rows.map((r) => r.seq)) };
}

type PostRow = { id: number; parent: number | null; voter: string; agent: string; body: string; review: boolean; at: string; score: number;
	record_id: string | null; topic_id: number | null; title: string | null; opening: boolean | null; revision: string };

/** One post by its number, which must be in the thread `thread` names (a record id, or forum/<topic>). It is read from
 * the post itself, not from the log, so it has no seq. */
export async function logEntry(db: Db, thread: string, id: number): Promise<Omit<LogEntry, 'seq' | 'mentions'>> {
	const p = Number.isSafeInteger(id) ? (await db.query<PostRow>(
		`SELECT c.id::int, c.parent_id::int AS parent, c.voter, c.agent, c.body, c.review, c.at, c.score, c.record_id, c.topic_id::int,
			coalesce(t.title, r.title) AS title, c.id = t.question_id AS opening, c.xmin::text AS revision
		 FROM open_index.comments c LEFT JOIN open_index.topics t ON t.id = c.topic_id LEFT JOIN open_index.records r ON r.id = c.record_id WHERE c.id = $1`, [id])).rows[0] : undefined;
	if (!p || threadPath(p) !== thread) throw new NotFoundError(`no post ${thread}/${id}`, `List the thread's posts with log ${thread}.`);
	const kind: Kind = p.record_id ? (p.review ? 'review' : 'comment') : p.parent !== null ? 'comment' : p.opening ? 'question' : 'answer';
	return { kind, path: `${thread}/${p.id}`, parent: p.parent === null ? null : `${thread}/${p.parent}`, by: p.voter, agent: p.agent,
		at: p.at, score: p.score, subject: p.title ?? '', body: p.body, revision: p.revision };
}
