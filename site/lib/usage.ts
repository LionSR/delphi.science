// How the API is used: calls per day, endpoint and client, counted in aggregate. The client is a name
// read from the user agent (ClaudeBot, ChatGPT-User, python-requests, curl, browser); the endpoint is
// the route pattern (GET /api/v1/records/{prefix}/{suffix}). No IP address, full user agent or URL is
// kept. lib/api.ts track() counts a call; /api/v1/stats and /stats show the counts.
import type { Db } from './query.ts';

export type Kind = 'ai' | 'search' | 'bot' | 'tool' | 'browser' | 'other';

// AI assistants, their crawlers and search engines, found anywhere in the user agent (they often sit
// inside a browser-like one: "Mozilla/5.0 … compatible; ChatGPT-User/1.0; +https://openai.com/bot").
const KNOWN: [string, Kind][] = [
	['Claude-User', 'ai'], ['Claude-SearchBot', 'ai'], ['ClaudeBot', 'ai'], ['Claude-Web', 'ai'], ['claude-code', 'ai'], ['anthropic-ai', 'ai'],
	['ChatGPT-User', 'ai'], ['OAI-SearchBot', 'ai'], ['GPTBot', 'ai'], ['codex', 'ai'],
	['Perplexity-User', 'ai'], ['PerplexityBot', 'ai'], ['MistralAI-User', 'ai'], ['DuckAssistBot', 'ai'],
	['Google-CloudVertexBot', 'ai'], ['Gemini-Deep-Research', 'ai'], ['GoogleAgent-Mariner', 'ai'],
	['meta-externalagent', 'ai'], ['meta-externalfetcher', 'ai'], ['Amazonbot', 'ai'], ['Bytespider', 'ai'], ['CCBot', 'ai'],
	['cohere-ai', 'ai'], ['YouBot', 'ai'], ['AI2Bot', 'ai'], ['PhindBot', 'ai'], ['Diffbot', 'ai'],
	['Googlebot', 'search'], ['GoogleOther', 'search'], ['bingbot', 'search'], ['Applebot', 'search'], ['DuckDuckBot', 'search'],
	['YandexBot', 'search'], ['Baiduspider', 'search'], ['PetalBot', 'search'], ['Kagibot', 'search'],
	['HeadlessChrome', 'bot'],
];
const KINDS = new Map(KNOWN.map(([name, kind]) => [name, kind]));
const BOTLIKE = /^[a-z][\w.-]*(?:bot|spider|crawler)$/i;

/** A short, stable name for the client that sent this user agent. */
export function client(ua: string | null | undefined): string {
	const s = (ua ?? '').trim();
	if (!s) return 'none';
	const low = s.toLowerCase();
	const known = KNOWN.find(([name]) => low.includes(name.toLowerCase()));
	if (known) return known[0];
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
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The first day (a Monday, UTC) of the week `weeks - 1` weeks before this one. */
export function since(weeks: number, now = new Date()) {
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * (weeks - 1));
	return iso(d);
}

/** Calls per week (all clients, and AI clients alone), the top endpoints and the top clients, over the last `weeks` weeks. */
export async function usage(db: Db, weeks = 8, now = new Date()) {
	const from = since(weeks, now);
	const rows = (await db.query<{ week: string; endpoint: string; client: string; calls: number }>(
		`SELECT to_char(date_trunc('week', day), 'YYYY-MM-DD') AS week, endpoint, client, sum(calls)::int AS calls
		 FROM open_index.api_usage WHERE day >= $1::date GROUP BY 1, 2, 3`, [from])).rows;
	const weekly = new Map<string, { week: string; calls: number; ai: number }>();
	for (let i = 0; i < weeks; i++) {
		const d = new Date(`${from}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + 7 * i);
		weekly.set(iso(d), { week: iso(d), calls: 0, ai: 0 });
	}
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
