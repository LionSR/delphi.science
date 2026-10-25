// API use counts: naming the client from its user agent, and counting calls on real Postgres (PGlite)
// with the migrations as written.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { client, countCall, kind, since, usage } from './usage.ts';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const migrated = async () => {
	const db = new PGlite({ extensions: { vector } });
	for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
	return db;
};

describe('client names', () => {
	test('AI assistants and crawlers are found anywhere in the user agent', () => {
		for (const [ua, name] of [
			['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ClaudeBot'],
			['Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)', 'Claude-User'],
			['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot', 'ChatGPT-User'],
			['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot', 'GPTBot'],
			['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)', 'PerplexityBot'],
			['claude-code/2.1.0', 'claude-code'],
			['codex_cli_rs/0.40.0 (Mac OS 15.5.0; arm64) iTerm.app/3.5', 'codex'],
			['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot'],
			['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'bingbot'],
		]) assert.equal(client(ua), name, ua);
	});
	test('anything else is named by its first product token, lower case, without the version', () => {
		for (const [ua, name] of [
			['curl/8.7.1', 'curl'],
			['python-requests/2.32.3', 'python-requests'],
			['Python-urllib/3.12', 'python-urllib'],
			['python-httpx/0.27.0', 'python-httpx'],
			['Go-http-client/2.0', 'go-http-client'],
			['node', 'node'],
			['Wget/1.21.4', 'wget'],
			['axios/1.7.2', 'axios'],
			['  PostmanRuntime/7.39.0 ', 'postmanruntime'],
		]) assert.equal(client(ua), name, ua);
	});
	test('browsers are browsers; unknown crawlers in a browser user agent keep their bot name', () => {
		assert.equal(client('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'), 'browser');
		assert.equal(client('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'), 'browser');
		assert.equal(client('Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'), 'semrushbot');
		assert.equal(client('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36'), 'HeadlessChrome');
	});
	test('empty and odd user agents', () => {
		assert.equal(client(null), 'none');
		assert.equal(client(''), 'none');
		assert.equal(client('   '), 'none');
		assert.equal(client('$$$'), 'other');
		assert.equal(client(`${'a'.repeat(100)}/1.0`).length, 32);
		assert.match(client('evil<script>/1'), /^[a-z0-9._-]+$/);
	});
	test('kinds', () => {
		assert.equal(kind('ClaudeBot'), 'ai');
		assert.equal(kind('ChatGPT-User'), 'ai');
		assert.equal(kind('Googlebot'), 'search');
		assert.equal(kind('semrushbot'), 'bot');
		assert.equal(kind('curl'), 'tool');
		assert.equal(kind('browser'), 'browser');
		assert.equal(kind('none'), 'other');
	});
});

describe('weeks', () => {
	test('start on Monday, UTC', () => {
		assert.equal(since(1, new Date('2026-10-25T23:00:00Z')), '2026-10-19'); // a Sunday
		assert.equal(since(1, new Date('2026-10-19T00:00:00Z')), '2026-10-19'); // a Monday
		assert.equal(since(8, new Date('2026-10-25T12:00:00Z')), '2026-08-31');
	});
});

describe('counting calls on Postgres', () => {
	test('calls add up per day, endpoint and client, and stats read them back', async () => {
		const db = await migrated();
		for (const [endpoint, name] of [['GET /llms.txt', 'ClaudeBot'], ['GET /llms.txt', 'ClaudeBot'], ['GET /api/v1/search', 'curl'], ['GET /llms.txt', 'curl']])
			await countCall(db, endpoint, name);
		const rows = (await db.query<{ endpoint: string; client: string; calls: number }>(
			'SELECT endpoint, client, calls FROM open_index.api_usage ORDER BY endpoint, client')).rows;
		assert.deepEqual(rows, [
			{ endpoint: 'GET /api/v1/search', client: 'curl', calls: 1 },
			{ endpoint: 'GET /llms.txt', client: 'ClaudeBot', calls: 2 },
			{ endpoint: 'GET /llms.txt', client: 'curl', calls: 1 },
		]);
		const u = await usage(db, 4);
		assert.equal(u.weekly.length, 4);
		assert.deepEqual(u.weekly.at(-1), { week: since(1), calls: 4, ai: 2 });
		assert.deepEqual(u.endpoints, [{ endpoint: 'GET /llms.txt', calls: 3 }, { endpoint: 'GET /api/v1/search', calls: 1 }]);
		assert.deepEqual(u.clients, [{ client: 'ClaudeBot', kind: 'ai', calls: 2 }, { client: 'curl', kind: 'tool', calls: 2 }]);
	});
	test('past 200 clients in a day, new ones count as other', async () => {
		const db = await migrated();
		for (let i = 0; i < 200; i++) await countCall(db, 'GET /api/v1', `tool${i}`);
		await countCall(db, 'GET /api/v1', 'one-too-many');
		await countCall(db, 'GET /api/v1/search', 'tool7'); // a client already seen today still counts by name
		const names = (await db.query<{ client: string }>("SELECT client FROM open_index.api_usage WHERE client IN ('other', 'one-too-many', 'tool7') ORDER BY client, endpoint")).rows.map((r) => r.client);
		assert.deepEqual(names, ['other', 'tool7', 'tool7']);
	});
});
