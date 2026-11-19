// A person's saved queries and where they left off (docs/my-feed.md; open_index.saved_queries).
//
// A subscription is a line of query text. An agent keeps its lines in a file and runs `delphi log -f <file> --new`;
// the copy here exists so the web can show the same feed. It is text, one query per line: blank lines and lines that
// start with # are kept as written and skipped when read, as `delphi log -f` skips them. The row belongs to the
// account, so the person's browser session and any of their agent keys read and replace it (the path me/queries).
import type { Db } from '#lib/db.ts';
import { CodedError, QueryError } from '#lib/errors.ts';
import { checkQuery, head, log, type LogEntry } from '#lib/posts/log.ts';
import type { Voter } from './keys.ts';

/** The path of the saved queries, for get, edit and post. */
export const QUERIES_PATH = 'me/queries';
/** The file the command line keeps them in. */
export const QUERIES_FILE = '~/.delphi/queries';
/** The most text that is stored, comments included. */
export const MAX_QUERIES_TEXT = 4000;
/** The longest q that log takes (lib/api/openapi.ts): the queries, joined as `delphi log -f` joins them, must fit it,
 * so the saved feed can always be asked for through any door. */
export const MAX_JOINED = 2000;

/** The queries of a text: its lines, without blank lines and comments. The rule of `delphi log -f` (cli/delphi.mjs). */
export const queryLines = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/** Several queries as the one query that matches when any of them does: what `delphi log -f` sends as q. */
export const joined = (lines: string[]) => lines.length === 1 ? lines[0] : lines.map((l) => `(${l})`).join(' OR ');

export type Problem = { line: number; text: string; message: string; fix: string };

/** Thrown when a text of queries cannot be saved. Nothing was saved: not the good lines either. */
export class QueriesError extends CodedError {
	readonly problems: Problem[];
	constructor(problems: Problem[]) {
		const [first] = problems;
		const more = problems.length > 1 ? ` (and ${problems.length - 1} more: ${problems.slice(1).map((p) => `line ${p.line}`).join(', ')})` : '';
		super(400, 'bad_request', first.line ? `line ${first.line} (${first.text}): ${first.message}${more}` : first.message, `${first.fix} Nothing was saved.`);
		this.problems = problems;
	}
}

/** The text as it is stored: Unix newlines, no space at the end of a line, no blank lines at either end. */
const tidy = (text: string) => text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').replace(/^\n+|\n+$/g, '');

/** Checks a text of queries for `login` and returns it as it will be stored. Each query is compiled as log would
 * compile it for that person (so to:@me is theirs); every bad line is reported, with its number and its fix. */
export function checkQueries(given: unknown, login: string): string {
	if (typeof given !== 'string') throw new QueriesError([{ line: 0, text: '', message: 'the queries are text', fix: 'Send one query per line.' }]);
	const text = tidy(given);
	if ([...text].length > MAX_QUERIES_TEXT) {
		throw new QueriesError([{ line: 0, text: '', message: `the text is ${[...text].length} characters, more than ${MAX_QUERIES_TEXT}`, fix: `Keep it to ${MAX_QUERIES_TEXT} characters.` }]);
	}
	const problems: Problem[] = [];
	text.split('\n').forEach((raw, i) => {
		const line = raw.trim();
		if (!line || line.startsWith('#')) return;
		try {
			checkQuery(line, login);
		} catch (e) {
			if (!(e instanceof QueryError)) throw e;
			problems.push({ line: i + 1, text: line, message: e.message, fix: e.fix });
		}
	});
	if (problems.length) throw new QueriesError(problems);
	const whole = joined(queryLines(text));
	if (whole.length > MAX_JOINED) {
		throw new QueriesError([{ line: 0, text: '', message: `together the queries are ${whole.length} characters as one log query, more than ${MAX_JOINED}`,
			fix: 'Save fewer or shorter queries: cat:math covers every math category, and one line can hold several terms joined by OR.' }]);
	}
	return text;
}

/** Whether a query can be read by somebody who is not signed in, and so has an Atom feed: it names nobody as @me. */
export function isPublicQuery(q: string): boolean {
	try {
		checkQuery(q, null);
		return true;
	} catch (e) {
		if (e instanceof QueryError) return false;
		throw e;
	}
}

export type Saved = { text: string; revision: string; at: string | null; seen: number };
type Row = { queries: string; revision: string; updated_at: string; seen_seq: number };
const NONE: Saved = { text: '', revision: '0', at: null, seen: 0 };
const saved = (r: Row | undefined): Saved => r ? { text: r.queries, revision: r.revision, at: r.updated_at, seen: r.seen_seq } : NONE;
const COLUMNS = 'queries, revision::text AS revision, updated_at, seen_seq::int AS seen_seq';
const key = (login: string) => login.toLowerCase();

/** A person's saved queries, their revision, and where they left off. Somebody who never saved any has the empty
 * text at revision 0. */
export async function savedQueries(db: Db, login: string): Promise<Saved> {
	return saved((await db.query<Row>(`SELECT ${COLUMNS} FROM open_index.saved_queries WHERE login = $1`, [key(login)])).rows[0]);
}

const conflict = () => new CodedError(409, 'edit_conflict', 'The saved queries changed since you read them',
	`Nothing was saved. Read them again (get ${QUERIES_PATH}), merge your change, and send the new revision.`);

/** Replaces a person's saved queries with `text`, all of it or none: one bad line and nothing changes. With a
 * revision, only if that is still the current one (409 edit_conflict otherwise); the same text again is always fine. */
export async function replaceQueries(db: Db, who: Pick<Voter, 'login'>, given: unknown, revision?: string): Promise<Saved> {
	const text = checkQueries(given, who.login);
	const now = await savedQueries(db, who.login);
	if (now.text === text) return now;
	if (revision !== undefined && revision !== now.revision) throw conflict();
	// The revision read above is part of the condition, so of two writers at once one finds no row and is told.
	const row = (await db.query<Row>(`INSERT INTO open_index.saved_queries AS s (login, queries, revision) VALUES ($1, $2, 1)
		ON CONFLICT (login) DO UPDATE SET queries = excluded.queries, revision = s.revision + 1, updated_at = now() WHERE s.revision = $3::bigint
		RETURNING ${COLUMNS}`, [key(who.login), text, now.revision])).rows[0];
	if (!row) throw conflict();
	return saved(row);
}

/** Adds queries to the end of a person's saved queries: each line of `given` that is not there already. It removes
 * and rewrites nothing. `added` is how many lines went in. */
export async function addQueries(db: Db, who: Pick<Voter, 'login'>, given: unknown): Promise<Saved & { added: number }> {
	const lines = queryLines(checkQueries(given, who.login));
	if (!lines.length) throw new QueriesError([{ line: 0, text: '', message: 'there is no query to add', fix: 'Send one query per line, e.g. cat:quant-ph.' }]);
	// Two additions at once: the second finds the revision moved and reads again.
	for (let attempt = 0; ; attempt++) {
		const now = await savedQueries(db, who.login);
		const have = new Set(queryLines(now.text));
		const fresh = [...new Set(lines)].filter((l) => !have.has(l));
		if (!fresh.length) return { ...now, added: 0 };
		try {
			return { ...await replaceQueries(db, who, [now.text, ...fresh].filter(Boolean).join('\n'), now.revision), added: fresh.length };
		} catch (e) {
			if (!(e instanceof CodedError && e.code === 'edit_conflict') || attempt >= 3) throw e;
		}
	}
}

// ---- My feed ----

/** How many entries the web shows to a page. */
export const FEED_PAGE = 50;

export type Feed = {
	/** The saved queries the feed is made of; none means there is no feed yet, and entries is empty. */
	queries: string[];
	entries: LogEntry[];
	/** The seq to send as before for the next, older page; null on the last page. */
	older: number | null;
	/** Where the person left off before this visit: entries with a larger seq are new to them. 0: no earlier visit. */
	seen: number;
};

/** One page of a person's feed: the log, read as that person, narrowed to what matches any of their saved queries,
 * newest first; with `q`, their search within it. It is what `delphi log -f <their queries>` lists, since
 * `joined(queries)` as log's q selects the same entries. It never falls back to the whole log. */
export async function myFeed(db: Db, who: Pick<Voter, 'login'>, opts: { q?: string; before?: number; limit?: number } = {}): Promise<Feed> {
	const mine = await savedQueries(db, who.login);
	const queries = queryLines(mine.text);
	if (!queries.length) return { queries, entries: [], older: null, seen: mine.seen };
	const limit = opts.limit ?? FEED_PAGE;
	const { entries } = await log(db, who.login, {}, { any: queries, q: opts.q, before: opts.before, limit: limit + 1 });
	const page = entries.slice(0, limit);
	return { queries, entries: page, older: entries.length > limit ? page.at(-1)!.seq : null, seen: mine.seen };
}

/** A visit to My feed: one page of it, the line to draw on it, and the one write a visit makes.
 *
 * The line is where the person left off before this visit (or `line`, when a link of this visit carries it: the pager
 * does, so the line stays put from page to page). The advance rule: opening the plain first page (no search, no
 * before, no carried line, and not a browser's prefetch) moves the stored place to the end of the log as it is now.
 * Capture the end before reading the page: an event arriving after the read must stay new on the next visit.
 * The page still uses the old position, so this visit shows what arrived since the previous one. */
export async function openFeed(db: Db, who: Pick<Voter, 'login'>, opts: { q?: string; before?: number; line?: number; prefetch?: boolean } = {}): Promise<Feed & { line: number; advanced: boolean }> {
	const plain = !opts.q?.trim() && opts.before === undefined && opts.line === undefined && !opts.prefetch;
	const through = plain ? await head(db) : undefined;
	const feed = await myFeed(db, who, { q: opts.q?.trim() || undefined, before: opts.before });
	const advanced = plain && feed.queries.length > 0;
	if (advanced) await markSeen(db, who, through);
	return { ...feed, line: opts.line ?? feed.seen, advanced };
}

/** Records that a person has seen the log up to now, and returns that place. It only moves forward. Called when they
 * open the first page of My feed (docs/my-feed.md, "The read position"); nothing an agent does calls it.
 * `through` is the end captured before reading that page, so a later arrival is not marked seen. */
export async function markSeen(db: Db, who: Pick<Voter, 'login'>, through?: number): Promise<number> {
	const seq = through ?? await head(db);
	await db.query(`INSERT INTO open_index.saved_queries AS s (login, seen_seq, seen_at) VALUES ($1, $2, now())
		ON CONFLICT (login) DO UPDATE SET seen_seq = excluded.seen_seq, seen_at = now() WHERE s.seen_seq < excluded.seen_seq`, [key(who.login), seq]);
	return seq;
}

/** The numbers of the posts in a thread that are new to a person: those after the place they left off, or after
 * `carried`, the line a link from My feed brought along (the feed moves the stored place as it is opened, so its links
 * carry the place it drew its line at). Read from the log as that person, so it is exactly what they may see. Empty
 * for nobody, and for somebody with no earlier visit to compare with. Reading a thread moves nothing. */
export async function newInThread(db: Db, who: Pick<Voter, 'login'> | null, scope: { record: string } | { topic: number }, carried?: number): Promise<Set<number>> {
	if (!who) return new Set();
	const seen = carried ?? (await savedQueries(db, who.login)).seen;
	if (seen <= 0) return new Set();
	const { entries } = await log(db, who.login, scope, { since: seen, limit: 200, q: 'NOT kind:record' });
	return new Set(entries.map((e) => Number(e.path.slice(e.path.lastIndexOf('/') + 1))));
}
