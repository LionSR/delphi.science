// How the API is used: calls per day, endpoint and client, counted in aggregate. The client is a name
// read from the user agent (ClaudeBot, ChatGPT-User, python-requests, curl, browser); the endpoint is
// the route pattern (GET /api/v1/records/{prefix}/{suffix}). No IP address, full user agent or URL is
// kept. lib/api.ts counted() counts a call; /api/v1/stats and /stats show the counts.
import type { Db } from './query.ts';

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
const BOTLIKE = /^[a-z][\w.-]*(?:bot|spider|crawler)$/i;

/** A short, stable name for the client that sent this user agent. */
export function client(ua: string | null | undefined): string {
	const s = (ua ?? '').trim();
	if (!s) return 'none';
	const low = s.toLowerCase();
	const known = [...KINDS.keys()].find((name) => low.includes(name.toLowerCase()));
	if (known) return known;
	if (/^(mozilla|opera)\//i.test(s)) {
		const bot = s.match(/\b([a-z][\w.-]*?(?:bot|spider|crawler))\b/i);
		return bot ? bot[1].toLowerCase().slice(0, 32) : 'browser';
	}
	// Anything else names itself first: curl/8.7.1, python-requests/2.32, Go-http-client/2.0, node.
	const first = low.split(/[\s/;(]/, 1)[0].replace(/[^a-z0-9._-]/g, '').slice(0, 32);
	return first || 'other';
}

/** What sort of client a name from client() is. */
export function kind(name: string): Kind {
	const k = KINDS.get(name);
	if (k) return k;
	if (name === 'browser') return 'browser';
	if (name === 'none' || name === 'other') return 'other';
	return BOTLIKE.test(name) ? 'bot' : 'tool';
}

// Past this many clients in a day, new ones count as 'other', so made-up user agents cannot grow the table.
const MAX_CLIENTS = 200;

/** Counts one call: today's (UTC) row for this endpoint and client goes up by one. */
export async function countCall(db: Db, endpoint: string, name: string) {
	await db.query(
		`INSERT INTO open_index.api_usage AS u (day, endpoint, client, calls)
		 SELECT t.day, $1, CASE WHEN EXISTS (SELECT 1 FROM open_index.api_usage WHERE day = t.day AND client = $2)
		     OR (SELECT count(DISTINCT client) FROM open_index.api_usage WHERE day = t.day) < $3 THEN $2 ELSE 'other' END, 1
		 FROM (SELECT (now() AT TIME ZONE 'utc')::date AS day) t
		 ON CONFLICT (day, endpoint, client) DO UPDATE SET calls = u.calls + 1`,
		[endpoint, name, MAX_CLIENTS]);
}

export const USAGE_NOTE = 'Calls are counted per day, endpoint and client, where the client is a name read from the user agent (ClaudeBot, python-requests, curl, browser). No IP address, full user agent or URL is kept. Answers the CDN serves from its cache are not counted. Page views are counted by Vercel Web Analytics, which is not public.';

const TOP = 20;

/** The first day (a Monday, UTC) of the week `weeks - 1` weeks before this one. */
export function since(weeks: number, now = new Date()) {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * (weeks - 1));
	return d.toISOString().slice(0, 10);
}

/** Calls per week (all clients, and AI clients alone), the top endpoints and the top clients, over the last `weeks` weeks. */
export async function usage(db: Db, weeks = 8, now = new Date()) {
	const from = since(weeks, now);
	const rows = (await db.query<{ week: string; endpoint: string; client: string; calls: number }>(
		`SELECT to_char(date_trunc('week', day), 'YYYY-MM-DD') AS week, endpoint, client, sum(calls)::int AS calls
		 FROM open_index.api_usage WHERE day >= $1::date GROUP BY 1, 2, 3`, [from])).rows;
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
