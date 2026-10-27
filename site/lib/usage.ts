// How the API is used: calls per day, endpoint and client, counted in aggregate. The client is a name
// read from the user agent (ClaudeBot, ChatGPT-User, python-requests, curl, browser); the endpoint is
// the route pattern (GET /api/v1/records/{prefix}/{suffix}). No IP address, full user agent or URL is
// kept. lib/api.ts counted() counts a call; /api/v1/stats and /stats show the counts.
import type { Db } from './query.ts';
import { operations } from './openapi.ts';

export type Kind = 'ai' | 'search' | 'bot' | 'tool' | 'browser' | 'other';

// AI assistants, their crawlers and search engines, found anywhere in the user agent (they often sit
// inside a browser-like one: "Mozilla/5.0 … compatible; ChatGPT-User/1.0; +https://openai.com/bot").
// The first match, in this order, names the client.
const KNOWN: [Kind, string[]][] = [
	['ai', ['Claude-User', 'Claude-SearchBot', 'ClaudeBot', 'Claude-Web', 'claude-code', 'anthropic-ai',
		'ChatGPT-User', 'OAI-SearchBot', 'GPTBot', 'codex',
		'Perplexity-User', 'PerplexityBot', 'MistralAI-User', 'DuckAssistBot',
		'Google-CloudVertexBot', 'Gemini-Deep-Research', 'GoogleAgent-Mariner',
		'meta-externalagent', 'meta-externalfetcher', 'Amazonbot', 'Bytespider', 'CCBot',
		'cohere-ai', 'YouBot', 'AI2Bot', 'PhindBot', 'Diffbot']],
	['search', ['Googlebot', 'GoogleOther', 'bingbot', 'Applebot', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'PetalBot', 'Kagibot']],
	['bot', ['HeadlessChrome']],
];
const KINDS = new Map(KNOWN.flatMap(([kind, names]) => names.map((name) => [name, kind] as const)));
const TOOLS = ['curl', 'python-requests', 'python-urllib', 'python-httpx', 'go-http-client', 'node', 'wget', 'axios', 'postmanruntime'];
// Never retain an arbitrary caller-supplied token: it may contain a name, email, key or unique ID.
export const CLIENTS = [...KINDS.keys(), ...TOOLS, 'browser', 'none', 'other'];
// Source checks and edits use the existing private attempt audit. Their aggregate categories are not in
// the deployed SQL allowlist; no schema/collection activation is implied.
export const ENDPOINTS = [...operations.filter((o) => !['checkPublicSources', 'editPost'].includes(o.operationId)).map((o) => `${o.method} ${o.path}`),
	'GET /api/v1', 'GET /api/v1/openapi.json', 'GET /llms.txt', 'POST /mcp',
	'GET /id/{prefix}/{suffix}', 'GET /sitemap.xml', 'GET /sitemap/{file}'];
export const RETENTION_DAYS = 90;

// Collection and irreversible retention cleanup require separate, explicit activation.
export const collectionEnabled = (env = process.env) => env.ORI_USAGE_ANALYTICS_ENABLED === 'true' && env.VERCEL_ENV !== 'preview';
export const retentionEnabled = (env = process.env) => collectionEnabled(env) && env.ORI_USAGE_RETENTION_ENABLED === 'true';

/** A short, stable name for the client that sent this user agent. */
export function client(ua: string | null | undefined): string {
	const s = (ua ?? '').slice(0, 2048).trim();
	if (!s) return 'none';
	const low = s.toLowerCase();
	// Match whole product tokens, not substrings inside a unique/custom product or URL.
	const products = new Set([...low.matchAll(/(?:^|[\s;(])([a-z][a-z0-9._-]*)(?=\/|[\s;)]|$)/g)].map((m) => m[1]));
	if (products.has('codex_cli_rs')) return 'codex';
	const known = [...KINDS.keys()].find((name) => products.has(name.toLowerCase()));
	if (known) return known;
	if (/^(mozilla|opera)\//i.test(s)) return 'browser';
	const first = low.split(/[\s/;(]/, 1)[0];
	return TOOLS.includes(first) ? first : 'other';
}

/** What sort of client a name from client() is. */
export function kind(name: string): Kind {
	const k = KINDS.get(name);
	if (k) return k;
	if (name === 'browser') return 'browser';
	if (name === 'none' || name === 'other') return 'other';
	return TOOLS.includes(name) ? 'tool' : 'other';
}

/** Retain today and the previous 89 UTC dates. Also run daily, even when there is no traffic. */
export async function pruneUsage(db: Db) {
	if (!retentionEnabled()) return;
	await db.query(`DELETE FROM open_index.api_usage WHERE day < (now() AT TIME ZONE 'utc')::date - ${RETENTION_DAYS - 1}`);
}

/** Counts one call: today's (UTC) row for this endpoint and client goes up by one. */
export async function countCall(db: Db, endpoint: string, name: string) {
	if (!collectionEnabled()) return;
	if (!ENDPOINTS.includes(endpoint)) return; // never write a resolved path, query, unknown route or method
	const safeClient = CLIENTS.includes(name) ? name : 'other';
	await pruneUsage(db);
	await db.query(
		`INSERT INTO open_index.api_usage AS u (day, endpoint, client, calls)
		 VALUES ((now() AT TIME ZONE 'utc')::date, $1, $2, 1)
		 ON CONFLICT (day, endpoint, client) DO UPDATE SET calls = least(u.calls::bigint + 1, 2147483647)::int`,
		[endpoint, safeClient]);
}

export const USAGE_NOTE = 'Origin API calls are aggregated by UTC day, fixed route pattern and allowlisted User-Agent product token. Unknown products count as other. Tokens are spoofable claims, not authenticated agent identities or unique visitors. No IPs, raw user agents, query strings, credentials, bodies or personal identifiers are stored in these metrics. CDN cache hits are not counted; failed metric writes are dropped. Reports show 90 UTC dates; deletion requires separate retention activation.';

const TOP = 20;

/** The first day (a Monday, UTC) of the week `weeks - 1` weeks before this one. */
export function since(weeks: number, now = new Date()) {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * (weeks - 1));
	return d.toISOString().slice(0, 10);
}

/** Calls per week (all clients, and AI clients alone), the top endpoints and the top clients, over the last `weeks` weeks. */
export async function usage(db: Db, weeks = 8, now = new Date()) {
	weeks = Math.max(1, Math.min(13, Number.isFinite(weeks) ? Math.trunc(weeks) : 8));
	const from = since(weeks, now);
	const rows = (await db.query<{ week: string; endpoint: string; client: string; calls: number }>(
		`SELECT to_char(date_trunc('week', day), 'YYYY-MM-DD') AS week, endpoint, client, sum(calls)::double precision AS calls
		 FROM open_index.api_usage
		 WHERE day >= greatest($1::date, (now() AT TIME ZONE 'utc')::date - ${RETENTION_DAYS - 1})
		 AND day <= (now() AT TIME ZONE 'utc')::date AND endpoint = ANY($2::text[]) AND client = ANY($3::text[])
		 GROUP BY 1, 2, 3`, [from, ENDPOINTS, CLIENTS])).rows;
	const weekly = new Map<string, { week: string; calls: number; ai: number }>();
	for (let w = weeks; w > 0; w--) weekly.set(since(w, now), { week: since(w, now), calls: 0, ai: 0 });
	const endpoints = new Map<string, number>(), clients = new Map<string, number>();
	for (const r of rows) {
		const w = weekly.get(r.week);
		if (w) { w.calls += r.calls; if (kind(r.client) === 'ai') w.ai += r.calls; }
		endpoints.set(r.endpoint, (endpoints.get(r.endpoint) ?? 0) + r.calls);
		clients.set(r.client, (clients.get(r.client) ?? 0) + r.calls);
	}
	const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP);
	return {
		since: from,
		weeks,
		weekly: [...weekly.values()],
		endpoints: top(endpoints).map(([endpoint, calls]) => ({ endpoint, calls })),
		clients: top(clients).map(([name, calls]) => ({ client: name, kind: kind(name), calls })),
	};
}
