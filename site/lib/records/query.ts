// Search for the open index: arXiv-style queries compiled to parameterized Postgres.
// Text terms rank by ts_rank_cd; with an embedding, keyword and vector ranks merge by reciprocal-rank fusion.
import stances from './stances.json' with { type: 'json' };
import type { Db } from '#lib/db.ts';
import { QueryError } from '#lib/errors.ts';
import { pageInfo, pageSize, pageStart, type PageRequest } from '#lib/paging.ts';
import { truncate } from '#lib/view.ts';
import { divisionOf, isSubjectCode, subjectNamed } from './taxonomy.ts';

export type Leaf = { field: string; value: string; phrase: boolean };
type Node = { op: 'AND' | 'OR' | 'NOT'; kids: Tree[] };
type Tree = Leaf | Node;

const TEXT: Record<string, [column: string, config: string]> = {
	'': ['all_tsv', 'english'], all: ['all_tsv', 'english'], ti: ['ti_tsv', 'english'], title: ['ti_tsv', 'english'],
	au: ['au_tsv', 'simple'], author: ['au_tsv', 'simple'], abs: ['abs_tsv', 'english'], abstract: ['abs_tsv', 'english'],
	tag: ['tag_tsv', 'english'],
};
const EXACT: Record<string, string> = { source: 'source', src: 'source', category: 'category', origin: 'origin', id: 'id', family: 'family' };
const IS_FLAGS: Record<string, [sql: string, meaning: string]> = {
	formalized: ['r.formalized', 'has a Lean formalization'],
	verified: ['r.verified', 'Lean checked it at Palomar, or it passed APP verification'],
	withdrawn: ['r.withdrawn', 'withdrawn at its source'],
	'agent-ready': ['r.agent_ready', 'ships instructions for agents, on agenticpapers.app'],
	'ai-generated': ["r.origin = 'ai-generated'", 'the source says AI made it'],
	app: ["r.source = 'app'", 'from agenticpapers.app'],
	gone: ['r.gone', 'its source no longer serves it'],
	discussed: ['r.discussed > 0', 'has posts or articles about it'],
	disputed: ['r.disputed', 'a response refutes or questions it'],
};
export const SORTS = ['relevance', 'newest', 'oldest', 'title', 'score', 'day', 'week', 'month', 'mentions', 'responded'] as const;
/** Search's page size (lib/paging.ts). */
export const SEARCH_PAGE = pageSize('Results', 100, 20);

// The query language as the docs describe it (OpenAPI, /api/v1, /llms.txt, MCP).
export const IS: Record<string, string> = Object.fromEntries(Object.entries(IS_FLAGS).map(([k, [, meaning]]) => [k, meaning]));
export const QUERY_FIELDS: Record<string, string> = {
	'ti au abs all': 'title, author, abstract, every text field (a bare word searches all)',
	cat: 'arXiv division or subdivision: cat:math, cat:math.NT, cat:quant-ph, or a subject name in quotes',
	'source category origin family id': 'exact values, e.g. source:openai-math id:app/APP-260923-0000',
	is: Object.entries(IS).map(([k, meaning]) => `${k} (${meaning})`).join(', '),
	published: 'published:[2026-10-01 TO *], published:2026-09',
};
export const OPERATORS = 'AND, OR, ANDNOT, NOT (uppercase), parentheses, "quoted phrases", word* prefixes; adjacent terms are ANDed';
const fieldNames = (group: string) => group.split(' ').map((f) => `${f}:`).join(' ');
/** One paragraph, under the 700 characters tool importers allow a parameter. */
export const QUERY_HELP = `arXiv-style query. ${Object.entries(QUERY_FIELDS).map(([f, about]) =>
	`${fieldNames(f)} ${f === 'is' ? Object.keys(IS).join(', ') : about}`).join('; ')}. ${OPERATORS}. Empty lists everything.`;
export const QUERY_GUIDE = [...Object.entries(QUERY_FIELDS).map(([f, about]) => `- ${fieldNames(f)} ${about}`), `- Operators: ${OPERATORS}`].join('\n');
export const SORT_HELP = 'relevance (default with a query), newest (default without), oldest, title, score (votes plus linked responses that confirm, simplify or extend it or have no stance yet, all time), day, week, month (votes and such responses published in that window), mentions (most cited in comments: how many people\'s comments name the record by id, then the newest; not linked posts, which count in score), responded (the newest expert response first, whatever its stance).';
const COMPACT = ['id', 'source', 'title', 'authors', 'url', 'pdf', 'published', 'subject', 'division', 'category', 'origin',
	'agent_ready', 'formalized', 'verified', 'withdrawn', 'disputed', 'family', 'ai_models', 'score', 'reactions', 'comments', 'reviews', 'mentions', 'discussed'];

// The stored record plus its live counts.
const SERVED = `r.record || jsonb_build_object('score', r.score, 'reactions', r.reactions, 'comments', r.comments_count, 'reviews', r.reviews_count, 'mentions', r.mentions_count, 'discussed', r.discussed, 'disputed', r.disputed)`;

// ---- Parsing ----

const TOKEN = /\s*(\(|\)|[A-Za-z_-]+:\[[^\]]*\]|[A-Za-z_-]+:"[^"]*"|"[^"]*"|[^\s()]+)/y;

function tokenize(q: string): string[] {
	const out: string[] = [];
	const text = q.trim();
	TOKEN.lastIndex = 0;
	while (TOKEN.lastIndex < text.length) {
		const at = TOKEN.lastIndex;
		const m = TOKEN.exec(text);
		if (!m) throw new QueryError(`cannot read the query near ${JSON.stringify(text.slice(at, at + 20))}`, 'Close every quote and bracket.');
		out.push(m[1]);
	}
	return out;
}

function leaf(tok: string): Leaf {
	const m = tok.match(/^([A-Za-z_-]+):(.*)$/);
	if (m && !tok.startsWith('"')) return { field: m[1].toLowerCase(), value: m[2].replace(/^"|"$/g, ''), phrase: m[2].startsWith('"') };
	return { field: '', value: tok.replace(/^"|"$/g, ''), phrase: tok.startsWith('"') };
}

export function parse(q: string): Tree {
	const toks = tokenize(q);
	if (!toks.length) throw new QueryError('the query is empty', 'Send q, for example q=ti:grokking or q="zero-free region".');
	let i = 0;
	const peek = () => toks[i];
	const expr = (): Tree => {
		const kids = [conj()];
		while (peek() === 'OR') { i++; kids.push(conj()); }
		return kids.length === 1 ? kids[0] : { op: 'OR', kids };
	};
	const conj = (): Tree => {
		const kids = [unary()];
		while (peek() !== undefined && peek() !== ')' && peek() !== 'OR') {
			if (peek() === 'AND') { i++; kids.push(unary()); }
			else if (peek() === 'ANDNOT') { i++; kids.push({ op: 'NOT', kids: [unary()] }); }
			else kids.push(unary()); // adjacent terms: implicit AND
		}
		return kids.length === 1 ? kids[0] : { op: 'AND', kids };
	};
	const unary = (): Tree => (peek() === 'NOT' ? (i++, { op: 'NOT', kids: [unary()] }) : primary());
	const primary = (): Tree => {
		const t = peek();
		if (t === undefined) throw new QueryError('the query ends early', 'Put a term after the last operator.');
		if (t === '(') {
			i++;
			const e = expr();
			if (peek() !== ')') throw new QueryError('a parenthesis is not closed', "Add the missing ')'.");
			i++;
			return e;
		}
		if ([')', 'AND', 'OR', 'ANDNOT'].includes(t)) throw new QueryError(`unexpected ${JSON.stringify(t)}`, 'Put a term before AND, OR or ANDNOT, and balance parentheses.');
		i++;
		return leaf(t);
	};
	const tree = expr();
	if (i < toks.length) throw new QueryError(`unexpected ${JSON.stringify(toks[i])}`, 'Balance parentheses.');
	return tree;
}

// ---- Compiling ----

function date(s: string, end: boolean): string | null {
	s = s.trim();
	if (s === '' || s === '*') return null;
	const m = s.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
	if (!m || (m[2] && (+m[2] < 1 || +m[2] > 12)) || (m[3] && (+m[3] < 1 || +m[3] > 31))) {
		throw new QueryError(`cannot read the date ${JSON.stringify(s)}`, 'Write dates as YYYY, YYYY-MM or YYYY-MM-DD.');
	}
	if (!m[2]) return `${m[1]}-${end ? '12-31' : '01-01'}`;
	if (!m[3]) return end ? new Date(Date.UTC(+m[1], +m[2], 0)).toISOString().slice(0, 10) : `${m[1]}-${m[2]}-01`;
	return s;
}


// The fields suggested when a query uses an unknown one.
export const FIELDS = [...Object.keys(TEXT).filter(Boolean), ...Object.keys(EXACT), 'cat', 'domain', 'is', 'published'].sort();

/** Compiles a parsed query to SQL over the records table, aliased r. A subclass adds fields of its own by
 * overriding leaf (lib/posts/log.ts does, for the log's events). */
export class Compiler {
	params: unknown[] = [];
	ranks: string[] = []; // tsquery expressions of positive text terms, for ranking
	/** The fields named when a query uses an unknown one. */
	fields = FIELDS;
	p(v: unknown) { this.params.push(v); return `$${this.params.length}`; }

	tree(t: Tree, positive = true): string {
		if ('op' in t) {
			if (t.op === 'NOT') return `NOT (${this.tree(t.kids[0], !positive)})`;
			return `(${t.kids.map((k) => this.tree(k, positive)).join(` ${t.op} `)})`;
		}
		return this.leaf(t, positive);
	}

	/** The tsquery of a text term and the column it searches; undefined for a field that is not text. */
	text(t: Leaf, positive: boolean): { column: string; tsq: string } | undefined {
		if (!(t.field in TEXT)) return undefined;
		const [column, cfg] = TEXT[t.field];
		const v = t.value;
		let tsq: string;
		if (!t.phrase && v.endsWith('*') && v.length > 1) {
			const stem = v.slice(0, -1).replace(/[^\p{L}\p{N}]/gu, '');
			if (!stem) throw new QueryError(`cannot search the prefix ${JSON.stringify(v)}`, 'Use letters or digits before *, e.g. grok*.');
			tsq = `to_tsquery('${cfg}', ${this.p(stem + ':*')})`;
		} else {
			tsq = `${t.phrase ? 'phraseto_tsquery' : 'plainto_tsquery'}('${cfg}', ${this.p(v)})`;
		}
		if (positive) this.ranks.push(tsq.replace(`'simple'`, `'english'`));
		return { column, tsq };
	}

	/** A text term over a record. Bare words also match author names as written (the 'simple' config does not stem). */
	textMatch({ column, tsq }: { column: string; tsq: string }): string {
		if (column === 'all_tsv') return `(r.all_tsv @@ ${tsq} OR r.au_tsv @@ ${tsq.replace(`'english'`, `'simple'`)})`;
		return `r.${column} @@ ${tsq}`;
	}

	leaf(t: Leaf, positive: boolean): string {
		const { field: f, value: v } = t;
		const text = this.text(t, positive);
		if (text) return this.textMatch(text);
		if (f === 'cat' || f === 'domain') {
			const fromName = subjectNamed(v);
			const code = fromName ?? v;
			if (isSubjectCode(code)) {
				const a = this.p(code), b = this.p(code + '.%'), c = this.p(code + '-%');
				return `(r.subject = ${a} OR r.division = ${a} OR r.subject LIKE ${b} OR r.subject LIKE ${c})`;
			}
			return `lower(r.domain) LIKE ${this.p('%' + v.toLowerCase() + '%')}`;
		}
		if (f in EXACT) return `r.${EXACT[f]} = ${this.p(EXACT[f] === 'family' && /^\d+$/.test(v) ? v.padStart(3, '0') : v)}`;
		if (f === 'is') {
			const flag = IS_FLAGS[v.toLowerCase()];
			if (!flag) throw new QueryError(`unknown flag is:${v}`, `Use ${Object.keys(IS_FLAGS).map((k) => 'is:' + k).join(', ')}.`);
			return flag[0];
		}
		if (f === 'published' || f === 'date') {
			const m = v.match(/^\[(.*?)\s+TO\s+(.*?)\]$/);
			const [lo, hi] = m ? [date(m[1], false), date(m[2], true)] : [date(v, false), date(v, true)];
			const conds = [lo && `r.published >= ${this.p(lo)}::date`, hi && `r.published <= ${this.p(hi)}::date`].filter(Boolean);
			return `(${conds.join(' AND ') || 'true'})`;
		}
		throw new QueryError(`unknown field ${f}:`, `Use one of: ${this.fields.map((x) => x + ':').join(', ')}.`);
	}
}

export function compile(q: string) {
	const c = new Compiler();
	const where = c.tree(parse(q));
	return { where, params: c.params, ranks: c.ranks };
}

// ---- Running ----

export function compact(rec: Record<string, unknown>) {
	const out: Record<string, unknown> = {};
	for (const k of COMPACT) {
		const v = rec[k];
		if (v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)) out[k] = v;
	}
	if (typeof rec.summary === 'string' && rec.summary) out.summary = truncate(rec.summary, 240);
	return out;
}

interface SearchOptions extends PageRequest {
	sort?: string;
	fields?: 'compact' | 'full';
	embedding?: number[]; // the query's embedding, for hybrid ranking
}

// When a discussion link d was posted: its own date, else the day it was attached.
const LINK_DATE = "coalesce(nullif(d->>'date', ''), d->>'added')";
// A link d that counts like an upvote. Stance names are inlined as SQL literals, so they must be plain words.
if (!stances.upvoting.every((s) => /^[a-z]+$/.test(s))) throw new Error('stances.json: every stance is a lowercase word');
const UPVOTE = `(${stances.unlabelled_upvotes ? "d->>'stance' IS NULL OR " : ''}d->>'stance' IN (${stances.upvoting.map((s) => `'${s}'`).join(', ')}))`;

// day/week/month rank by net votes plus upvoting links in the window; mentions ranks by comment mentions.
// Few records have either, so only those records (hot) are ranked. The rest (cold) follow in published
// order, and are read only as far as the page needs.
type Ranked = (where: string) => { with?: string; hot: string; cold: string };

const recent = (days: number): Ranked => (where) => ({
	with: `hot AS (
			SELECT id, sum(points)::int AS points FROM (
				SELECT v.record_id AS id, v.value AS points FROM open_index.votes v WHERE v.at > now() - interval '${days} days'
				UNION ALL
				SELECT r.id, (SELECT count(*) FROM jsonb_array_elements(r.record->'discussion') d
					WHERE ${LINK_DATE}::date > current_date - ${days}
					AND ${UPVOTE})::int
				FROM open_index.records r WHERE r.discussed > 0
			) x GROUP BY id HAVING sum(points) <> 0),`,
	hot: `SELECT r.*, h.points FROM open_index.records r JOIN hot h ON h.id = r.id WHERE ${where}`,
	cold: 'NOT EXISTS (SELECT 1 FROM hot WHERE hot.id = r.id)',
});

// Filtered inline (index records_mentioned) rather than as a CTE, which can scan every record of a broad
// filter while the table has no statistics.
const mentioned: Ranked = (where) => ({
	hot: `SELECT r.*, r.mentions_count AS points FROM open_index.records r WHERE r.mentions_count > 0 AND ${where}`,
	cold: 'r.mentions_count <= 0',
});

const RANKED: Record<string, Ranked> = { day: recent(1), week: recent(7), month: recent(30), mentions: mentioned };

const ORDER: Record<string, string> = {
	newest: 'r.published DESC NULLS LAST, r.id',
	oldest: 'r.published ASC NULLS LAST, r.id',
	title: 'lower(r.title), r.id',
	score: '(r.score + r.upvoting) DESC, r.published DESC NULLS LAST, r.id',
	responded: 'r.responded DESC NULLS LAST, r.published DESC NULLS LAST, r.id',
};

function rankedSql(ranked: Ranked, where: string, n: number): string {
	const { with: ctes = '', hot, cold } = ranked(where);
	return `WITH ${ctes}
		cand AS (
			${hot}
			UNION ALL
			(SELECT r.*, 0 FROM open_index.records r WHERE ${where} AND ${cold}
			 ORDER BY r.published DESC NULLS LAST, r.id LIMIT $${n + 1}::int + $${n + 2}::int))
		SELECT ${SERVED} AS record FROM cand r ORDER BY r.points DESC, r.published DESC NULLS LAST, r.id LIMIT $${n + 1} OFFSET $${n + 2}`;
}

export async function search(db: Db, q: string, opts: SearchOptions = {}) {
	const t0 = performance.now();
	const sort = opts.sort ?? (q.trim() ? 'relevance' : 'newest');
	if (!(SORTS as readonly string[]).includes(sort)) throw new QueryError(`unknown sort ${JSON.stringify(sort)}`, `Use sort=${SORTS.join(', sort=')}.`);
	const fields = opts.fields ?? 'compact';
	if (fields !== 'compact' && fields !== 'full') throw new QueryError(`unknown fields ${JSON.stringify(fields)}`, 'Use fields=compact (default) or fields=full.');
	const start = pageStart(opts, SEARCH_PAGE);
	// An empty query lists everything.
	const { where, params, ranks } = q.trim() ? compile(q) : { where: 'true', params: [] as unknown[], ranks: [] as string[] };
	const n = params.length;
	let sql: string;
	const all = [...params];
	if (sort === 'relevance' && (ranks.length || opts.embedding)) {
		const rank = ranks.length ? `ts_rank_cd(r.all_tsv, ${ranks.map((x) => `(${x})`).join(' || ')})` : '0';
		if (opts.embedding) {
			all.push(`[${opts.embedding.join(',')}]`);
			const e = `$${n + 1}::extensions.vector`;
			// Each side reads the table with the filters, so the vector side can use the HNSW index.
			sql = `WITH kw AS (${ranks.length
					? `SELECT r.id, row_number() OVER (ORDER BY ${rank} DESC) AS k FROM open_index.records r WHERE ${where} ORDER BY ${rank} DESC LIMIT 200`
					: 'SELECT NULL::text AS id, NULL::bigint AS k WHERE false'}),
				vec AS (SELECT r.id, row_number() OVER (ORDER BY r.embedding OPERATOR(extensions.<=>) ${e}) AS k FROM open_index.records r
				        WHERE ${where} AND r.embedding IS NOT NULL ORDER BY r.embedding OPERATOR(extensions.<=>) ${e} LIMIT 200)
				SELECT ${SERVED} AS record FROM open_index.records r
				JOIN (SELECT coalesce(kw.id, vec.id) AS id, coalesce(1.0 / (60 + kw.k), 0) + coalesce(1.0 / (60 + vec.k), 0) AS score
				      FROM kw FULL JOIN vec ON kw.id = vec.id) s ON s.id = r.id
				ORDER BY s.score DESC, r.published DESC NULLS LAST LIMIT $${n + 2} OFFSET $${n + 3}`;
		} else {
			sql = `SELECT ${SERVED} AS record FROM open_index.records r WHERE ${where} ORDER BY ${rank} DESC, r.published DESC NULLS LAST LIMIT $${n + 1} OFFSET $${n + 2}`;
		}
	} else if (RANKED[sort]) {
		sql = rankedSql(RANKED[sort], where, n);
	} else {
		sql = `SELECT ${SERVED} AS record FROM open_index.records r WHERE ${where} ORDER BY ${ORDER[sort] ?? ORDER.newest} LIMIT $${n + 1} OFFSET $${n + 2}`;
	}
	all.push(start.limit, start.offset);
	// Count the matches in parallel with the page query, unless the cursor already holds the total.
	const [rows, total] = await Promise.all([
		db.query<{ record: Record<string, unknown> }>(sql, all).then((r) => r.rows),
		start.total ?? db.query<{ n: number }>(`SELECT count(*)::int AS n FROM open_index.records r WHERE ${where}`, params).then((r) => Number(r.rows[0].n)),
	]);
	return {
		query: q, sort, count: rows.length,
		results: rows.map((r): Record<string, unknown> =>
			({ ...(fields === 'full' ? r.record : compact(r.record)), links: { self: `/api/v1/records/${r.record.id}` } })),
		...pageInfo(start, total, rows.length),
		took_ms: Math.round((performance.now() - t0) * 10) / 10,
	};
}

export async function get(db: Db, id: string) {
	const rows = (await db.query<{ record: Record<string, unknown> }>(
		`SELECT ${SERVED} AS record FROM open_index.records r WHERE r.id = $1`, [id])).rows;
	return rows[0]?.record ?? null;
}

/** How many records each source has, most first. */
export const sourceCounts = async (d: Db) => (await d.query<{ source: string; n: number }>(
	'SELECT source, count(*)::int AS n FROM open_index.records GROUP BY source ORDER BY n DESC')).rows;
