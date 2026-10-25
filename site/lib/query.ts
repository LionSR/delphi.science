// Search for the open index: arXiv's query syntax, compiled to Postgres (supabase/migrations/*_open_index.sql).
// The same syntax as query.py (repo root), which compiles it to SQLite for the downloadable snapshot.
//
//   ti:grokking AND au:openai          title, author         (arXiv: ti, au, abs, all)
//   abs:"zero-free region" ANDNOT ti:survey
//   cat:math  cat:math.NT  cat:"number theory"              division, subdivision, or a subject name
//   source:openai-math is:formalized is:discussed is:disputed   category:research origin:ai-generated family:017 id:<id>
//   published:[2026-10-01 TO *]        grok*  (prefix)      bare words search every text field
//
// Operators AND, OR, ANDNOT, NOT (uppercase), parentheses; adjacent terms are ANDed. Text terms rank by
// ts_rank_cd (title weighted highest); with an embedding, keyword and vector ranks merge by reciprocal-rank
// fusion. Everything the caller sends becomes a bound parameter: no user text is spliced into SQL.
import taxonomy from './taxonomy.json' with { type: 'json' };

export class QueryError extends Error {
	readonly fix: string;
	constructor(message: string, fix: string) {
		super(message);
		this.fix = fix;
	}
}

type Leaf = { field: string; value: string; phrase: boolean };
type Node = { op: 'AND' | 'OR' | 'NOT'; kids: Tree[] };
type Tree = Leaf | Node;

const TEXT: Record<string, [column: string, config: string]> = {
	'': ['all_tsv', 'english'], all: ['all_tsv', 'english'], ti: ['ti_tsv', 'english'], title: ['ti_tsv', 'english'],
	au: ['au_tsv', 'simple'], author: ['au_tsv', 'simple'], abs: ['abs_tsv', 'english'], abstract: ['abs_tsv', 'english'],
	tag: ['tag_tsv', 'english'],
};
const EXACT: Record<string, string> = { source: 'source', src: 'source', category: 'category', origin: 'origin', id: 'id', family: 'family' };
// Posts and articles about the record (record.discussion, attached by index.py discuss; r.discussed is their
// stored count). Those that confirm, simplify or extend it, or have no stance yet (r.upvoting), count like an
// upvote in the popularity sorts: all of them in score, the ones posted in the window in day, week and month.
// One that refutes or questions it marks the record disputed instead.
export const FLAGS: Record<string, string> = {
	formalized: 'r.formalized', verified: 'r.verified', withdrawn: 'r.withdrawn', 'agent-ready': 'r.agent_ready',
	'ai-generated': "r.origin = 'ai-generated'", app: "r.source = 'app'", gone: 'r.gone', discussed: 'r.discussed > 0',
	disputed: 'r.disputed',
};
export const SORTS = ['relevance', 'newest', 'oldest', 'title', 'score', 'day', 'week', 'month', 'mentions'] as const;
export const MAX_LIMIT = 100;
const COMPACT = ['id', 'source', 'title', 'authors', 'url', 'pdf', 'published', 'subject', 'division', 'category', 'origin',
	'agent_ready', 'formalized', 'verified', 'withdrawn', 'disputed', 'family', 'ai_models', 'score', 'reactions', 'comments', 'reviews', 'mentions', 'discussed'];

// The record as the API serves it: the stored JSON plus the live counts.
const SERVED = `r.record || jsonb_build_object('score', r.score, 'reactions', r.reactions, 'comments', r.comments_count, 'reviews', r.reviews_count, 'mentions', r.mentions_count, 'discussed', r.discussed, 'disputed', r.disputed)`;

// ---- Parsing ----

const TOKEN = /\s*(\(|\)|[A-Za-z_-]+:\[[^\]]*\]|[A-Za-z_-]+:"[^"]*"|"[^"]*"|[^\s()]+)/y;

export function tokenize(q: string): string[] {
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

// The rules of taxonomy.py (is_code, division_of), read from the JSON its build writes.
const divisionOf = (c: string) =>
	taxonomy.divisions.find((d) => d.prefixes.some((p) => c === p || c.startsWith(p + '.') || c.startsWith(p + '-')))?.key ?? 'other';
const isSubjectCode = (c: string) => /^[a-z]+(?:-[a-z]+)?(?:\.[A-Za-z-]+)?$/.test(c) && (c in taxonomy.names || divisionOf(c) !== 'other');

class Compiler {
	params: unknown[] = [];
	ranks: string[] = []; // tsquery expressions of positive text terms, for ranking
	p(v: unknown) { this.params.push(v); return `$${this.params.length}`; }

	tree(t: Tree, positive = true): string {
		if ('op' in t) {
			if (t.op === 'NOT') return `NOT (${this.tree(t.kids[0], !positive)})`;
			return `(${t.kids.map((k) => this.tree(k, positive)).join(` ${t.op} `)})`;
		}
		const { field: f, value: v } = t;
		if (f in TEXT) {
			const [col, cfg] = TEXT[f];
			let tsq: string;
			if (!t.phrase && v.endsWith('*') && v.length > 1) {
				const stem = v.slice(0, -1).replace(/[^\p{L}\p{N}]/gu, '');
				if (!stem) throw new QueryError(`cannot search the prefix ${JSON.stringify(v)}`, 'Use letters or digits before *, e.g. grok*.');
				tsq = `to_tsquery('${cfg}', ${this.p(stem + ':*')})`;
			} else {
				tsq = `${t.phrase ? 'phraseto_tsquery' : 'plainto_tsquery'}('${cfg}', ${this.p(v)})`;
			}
			if (positive) this.ranks.push(tsq.replace(`'simple'`, `'english'`));
			// Bare words also match author names as written (the 'simple' config does not stem).
			if (col === 'all_tsv') return `(r.all_tsv @@ ${tsq} OR r.au_tsv @@ ${tsq.replace(`'english'`, `'simple'`)})`;
			return `r.${col} @@ ${tsq}`;
		}
		if (f === 'cat' || f === 'domain') {
			const fromName = (taxonomy.from_name as Record<string, string>)[v.toLowerCase()];
			const code = fromName ?? v;
			if (isSubjectCode(code)) {
				const a = this.p(code), b = this.p(code + '.%'), c = this.p(code + '-%');
				return `(r.subject = ${a} OR r.division = ${a} OR r.subject LIKE ${b} OR r.subject LIKE ${c})`;
			}
			return `lower(r.domain) LIKE ${this.p('%' + v.toLowerCase() + '%')}`;
		}
		if (f in EXACT) return `r.${EXACT[f]} = ${this.p(EXACT[f] === 'family' && /^\d+$/.test(v) ? v.padStart(3, '0') : v)}`;
		if (f === 'is') {
			const flag = FLAGS[v.toLowerCase()];
			if (!flag) throw new QueryError(`unknown flag is:${v}`, `Use ${Object.keys(FLAGS).map((k) => 'is:' + k).join(', ')}.`);
			return flag;
		}
		if (f === 'published' || f === 'date') {
			const m = v.match(/^\[(.*?)\s+TO\s+(.*?)\]$/);
			const [lo, hi] = m ? [date(m[1], false), date(m[2], true)] : [date(v, false), date(v, true)];
			const conds = [lo && `r.published >= ${this.p(lo)}::date`, hi && `r.published <= ${this.p(hi)}::date`].filter(Boolean);
			return `(${conds.join(' AND ') || 'true'})`;
		}
		const fields = [...new Set([...Object.keys(TEXT).filter(Boolean), ...Object.keys(EXACT), 'cat', 'domain', 'is', 'published'])].sort();
		throw new QueryError(`unknown field ${f}:`, `Use one of: ${fields.map((x) => x + ':').join(', ')}.`);
	}
}

export function compile(q: string) {
	const c = new Compiler();
	const where = c.tree(parse(q));
	return { where, params: c.params, ranks: c.ranks };
}

// ---- Running ----

/** Anything that runs a parameterized query: PGlite's db.query, or postgres.js via sql.unsafe. */
export type Db = { query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> };

// A cursor carries where the next page starts and the total, so later pages skip the count.
const encode = (o: number, t: number) => btoa(JSON.stringify({ o, t })).replace(/=+$/, '');
function decode(cursor?: string | null): { offset: number; total?: number } {
	if (!cursor) return { offset: 0 };
	try {
		const { o, t } = JSON.parse(atob(cursor));
		if (Number.isInteger(o) && o >= 0) return { offset: o, total: Number.isInteger(t) ? t : undefined };
	} catch { /* fall through */ }
	throw new QueryError('the cursor is not valid', 'Pass next_cursor from the previous reply unchanged.');
}

function compact(rec: Record<string, unknown>) {
	const out: Record<string, unknown> = {};
	for (const k of COMPACT) {
		const v = rec[k];
		if (v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)) out[k] = v;
	}
	const s = typeof rec.summary === 'string' ? rec.summary : '';
	if (s) out.summary = s.length <= 240 ? s : s.slice(0, 239).replace(/\s+\S*$/, '') + '…';
	out.links = { self: `/api/v1/records/${rec.id}` };
	return out;
}

export interface SearchOptions {
	limit?: number;
	cursor?: string | null;
	sort?: string;
	fields?: 'compact' | 'full';
	embedding?: number[]; // the query's embedding, for hybrid ranking
}

// day, week, month: as on SciRate, the net votes cast in that many days plus the posts and articles published in
// them that count as upvotes (a link's own date; the day it was attached only when the source gives none), then the newest. Almost no record has either, so only the candidates are ranked (the votes table, and the few rows with
// links); the rest come from the published index, already in order, and only as many as the page needs.
function recentSql(days: number, where: string, n: number): string {
	return `WITH hot AS (
			SELECT id, sum(points)::int AS points FROM (
				SELECT v.record_id AS id, v.value AS points FROM open_index.votes v WHERE v.at > now() - interval '${days} days'
				UNION ALL
				SELECT r.id, (SELECT count(*) FROM jsonb_array_elements(r.record->'discussion') d
					WHERE coalesce(nullif(d->>'date', ''), d->>'added')::date > current_date - ${days}
					AND coalesce(d->>'stance', 'confirms') IN ('confirms', 'simplifies', 'extends'))::int -- as index.py UPVOTING
				FROM open_index.records r WHERE r.discussed > 0
			) x GROUP BY id HAVING sum(points) <> 0),
		cand AS (
			SELECT r.*, h.points FROM open_index.records r JOIN hot h ON h.id = r.id WHERE ${where}
			UNION ALL
			(SELECT r.*, 0 FROM open_index.records r WHERE ${where} AND NOT EXISTS (SELECT 1 FROM hot WHERE hot.id = r.id)
			 ORDER BY r.published DESC NULLS LAST, r.id LIMIT $${n + 1}::int + $${n + 2}::int))
		SELECT ${SERVED} AS record FROM cand r ORDER BY r.points DESC, r.published DESC NULLS LAST, r.id LIMIT $${n + 1} OFFSET $${n + 2}`;
}

export async function search(db: Db, q: string, opts: SearchOptions = {}) {
	const t0 = performance.now();
	const sort = opts.sort ?? 'relevance';
	if (!(SORTS as readonly string[]).includes(sort)) throw new QueryError(`unknown sort ${JSON.stringify(sort)}`, `Use sort=${SORTS.join(', sort=')}.`);
	const fields = opts.fields ?? 'compact';
	if (fields !== 'compact' && fields !== 'full') throw new QueryError(`unknown fields ${JSON.stringify(fields)}`, 'Use fields=compact (default) or fields=full.');
	const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? 20), MAX_LIMIT));
	const { offset, total: known } = decode(opts.cursor);
	// An empty query lists everything (the front page, or an agent reading the newest records).
	const { where, params, ranks } = q.trim() ? compile(q) : { where: 'true', params: [] as unknown[], ranks: [] as string[] };
	const n = params.length;
	const total = known ?? Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM open_index.records r WHERE ${where}`, params)).rows[0].n);

	const order: Record<string, string> = { newest: 'r.published DESC NULLS LAST, r.id', oldest: 'r.published ASC NULLS LAST, r.id',
		title: 'lower(r.title), r.id', score: '(r.score + r.upvoting) DESC, r.published DESC NULLS LAST, r.id', // records_top
		mentions: 'r.mentions_count DESC, r.score DESC, r.id' };
	const window: Record<string, number> = { day: 1, week: 7, month: 30 };
	let sql: string;
	let all = [...params];
	if (sort === 'relevance' && (ranks.length || opts.embedding)) {
		const rank = ranks.length ? `ts_rank_cd(r.all_tsv, ${ranks.map((x) => `(${x})`).join(' || ')})` : '0';
		if (opts.embedding) {
			// Reciprocal-rank fusion of the keyword and vector rankings, over the records the filters allow.
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
	} else if (window[sort]) {
		sql = recentSql(window[sort], where, n);
	} else {
		sql = `SELECT ${SERVED} AS record FROM open_index.records r WHERE ${where} ORDER BY ${order[sort] ?? order.newest} LIMIT $${n + 1} OFFSET $${n + 2}`;
	}
	all.push(limit, offset);
	const rows = (await db.query<{ record: Record<string, unknown> }>(sql, all)).rows;
	const next = offset + rows.length;
	return {
		query: q, sort, total, count: rows.length,
		results: rows.map((r) => (fields === 'full' ? { ...r.record, links: { self: `/api/v1/records/${r.record.id}` } } : compact(r.record))),
		next_cursor: next < total && rows.length ? encode(next, total) : null,
		took_ms: Math.round((performance.now() - t0) * 10) / 10,
	};
}

export async function get(db: Db, id: string) {
	const rows = (await db.query<{ record: Record<string, unknown> }>(
		`SELECT ${SERVED} AS record FROM open_index.records r WHERE r.id = $1`, [id])).rows;
	return rows[0]?.record ?? null;
}
