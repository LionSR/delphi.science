// API use counts: naming the client from its user agent, and counting calls on real Postgres (PGlite)
// with the migrations as written.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { CLIENTS, ENDPOINTS, client, collectionEnabled, countCall, kind, pruneUsage, retentionEnabled, since, usage } from './usage.ts';
import { canReadUsage } from './usage-admin.ts';
import { emptyDb, migratedDb, migrations } from '../testing.ts';

const flagNames = ['ORI_USAGE_ANALYTICS_ENABLED', 'ORI_USAGE_RETENTION_ENABLED', 'VERCEL_ENV'] as const;
const savedFlags = Object.fromEntries(flagNames.map((name) => [name, process.env[name]]));
before(() => {
	process.env.ORI_USAGE_ANALYTICS_ENABLED = 'true';
	process.env.ORI_USAGE_RETENTION_ENABLED = 'true';
	delete process.env.VERCEL_ENV;
});
after(() => { for (const name of flagNames) { if (savedFlags[name] === undefined) delete process.env[name]; else process.env[name] = savedFlags[name]; } });

describe('client names', () => {
	test('known products are named from anywhere in the user agent; nothing else of it is kept, since it could hold a name, email, key or URL', () => {
		for (const [ua, name] of [
			// AI assistants and crawlers, often inside a browser-like user agent
			['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ClaudeBot'],
			['claude-code/2.1.0', 'claude-code'],
			['codex_cli_rs/0.40.0 (Mac OS 15.5.0; arm64) iTerm.app/3.5', 'codex'],
			['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot'],
			['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36', 'HeadlessChrome'],
			// allowlisted HTTP tools, without the version
			['curl/8.7.1', 'curl'], ['node', 'node'], ['Wget/1.21.4', 'wget'], ['  PostmanRuntime/7.39.0 ', 'postmanruntime'],
			// browsers, and unknown crawlers inside browser user agents
			['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'browser'],
			['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', 'browser'],
			['Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)', 'browser'],
			// empty, odd, and arbitrary tokens, emails, keys, URLs and substrings of known names
			[null, 'none'], ['', 'none'], ['   ', 'none'], ['$$$', 'other'], ['evil<script>/1', 'other'],
			['person@example.org/1', 'other'], ['unique-person-bot/1', 'other'], ['oik_secret', 'other'], ['Bearer secret', 'other'],
			['https://example.org/ClaudeBot', 'other'], ['private-ClaudeBot/1', 'other'], [`${'a'.repeat(100)}/1.0`, 'other'], ['a'.repeat(10000), 'other'],
		] as const) assert.equal(client(ua), name, String(ua));
	});
	test('each client name has a kind; unknown names are other', () => {
		for (const [name, k] of [['ClaudeBot', 'ai'], ['Googlebot', 'search'], ['HeadlessChrome', 'bot'], ['curl', 'tool'], ['browser', 'browser'],
			['none', 'other'], ['other', 'other'], ['semrushbot', 'other']]) assert.equal(kind(name), k, name);
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
		const db = await migratedDb();
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
	test('unknown products collapse to one bucket and unique endpoints never get stored', async () => {
		const db = await migratedDb();
		try {
			await Promise.all(Array.from({length: 220}, (_, i) => countCall(db, 'GET /api/v1', `person-${i}@example.org`)));
			for (const path of ['GET /id/arxiv/unique-id', 'GET /api/v1/search?q=private', 'GET /private']) await countCall(db, path, 'curl');
			assert.deepEqual((await db.query('SELECT endpoint, client, calls FROM open_index.api_usage')).rows,
				[{endpoint: 'GET /api/v1', client: 'other', calls: 220}]);
			await assert.rejects(db.query("INSERT INTO open_index.api_usage VALUES (current_date, 'GET /api/v1', 'unique-person', 1)"), /api_usage_client_category/);
			await assert.rejects(db.query("INSERT INTO open_index.api_usage VALUES (current_date, 'GET /private', 'curl', 1)"), /api_usage_endpoint_category/);
		} finally { await db.close(); }
	});
});

test('fixed categories match the database constraints; only four aggregate columns exist', async () => {
	const db = await migratedDb();
	try {
		for (const name of CLIENTS) await countCall(db, 'GET /api/v1', name);
		for (const endpoint of ENDPOINTS) await countCall(db, endpoint, 'curl');
		const columns = (await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema='open_index' AND table_name='api_usage' ORDER BY ordinal_position")).rows;
		assert.deepEqual(columns.map(r => r.column_name), ['day', 'endpoint', 'client', 'calls']);
		assert.equal((await db.query('SELECT DISTINCT client FROM open_index.api_usage')).rows.length, CLIENTS.length);
		assert.equal((await db.query('SELECT DISTINCT endpoint FROM open_index.api_usage')).rows.length, ENDPOINTS.length);
		assert.equal((await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid='open_index.api_usage'::regclass")).rows[0].relrowsecurity, true);
		assert.equal((await db.query("SELECT * FROM pg_policies WHERE schemaname='open_index' AND tablename='api_usage'")).rows.length, 0);
		await db.query("UPDATE open_index.api_usage SET calls=2147483647 WHERE client='none'");
		await countCall(db, 'GET /api/v1', 'none');
		assert.ok((await usage(db)).weekly.at(-1)!.calls > 2147483647);
	} finally { await db.close(); }
});

test('retains exactly 90 UTC dates, with repeatable cleanup even when traffic stops', async () => {
	const db = await migratedDb();
	try {
		await db.exec(`SET TIME ZONE 'Pacific/Honolulu'; INSERT INTO open_index.api_usage
			SELECT (now() AT TIME ZONE 'utc')::date - n, 'GET /api/v1', 'curl', 1 FROM generate_series(0, 95) n`);
		await pruneUsage(db); await pruneUsage(db);
		assert.equal((await db.query('SELECT * FROM open_index.api_usage')).rows.length, 90);
		assert.equal((await usage(db, 999)).weeks, 13);
		await db.exec("INSERT INTO open_index.api_usage VALUES ((now() AT TIME ZONE 'utc')::date - 100, 'GET /llms.txt', 'curl', 1)");
		await countCall(db, 'GET /llms.txt', 'curl');
		assert.equal((await db.query("SELECT * FROM open_index.api_usage WHERE day < (now() AT TIME ZONE 'utc')::date - 89")).rows.length, 0);
	} finally { await db.close(); }
});

test('migration preserves legacy rows while reports exclude unsafe dimensions and old dates', async () => {
	const db = emptyDb();
	try {
		for (const m of migrations()) {
			if (m.name.includes('private_bounded_usage')) await db.exec(`INSERT INTO open_index.api_usage VALUES
			 ((now() AT TIME ZONE 'utc')::date, 'GET /api/v1', 'private-person@example.org', 1),
			 ((now() AT TIME ZONE 'utc')::date, 'GET /id/arxiv/unique-id', 'curl', 1),
			 ((now() AT TIME ZONE 'utc')::date - 100, 'GET /api/v1', 'curl', 1),
			 ((now() AT TIME ZONE 'utc')::date, 'GET /api/v1', 'curl', 2)`);
			await db.exec(m.sql);
		}
		assert.equal((await db.query('SELECT * FROM open_index.api_usage')).rows.length, 4);
		const beforeRead = JSON.stringify((await db.query('SELECT * FROM open_index.api_usage ORDER BY day, endpoint, client')).rows);
		assert.deepEqual((await usage(db)).clients, [{client: 'curl', kind: 'tool', calls: 2}]);
		assert.equal(JSON.stringify((await db.query('SELECT * FROM open_index.api_usage ORDER BY day, endpoint, client')).rows), beforeRead);
	} finally { await db.close(); }
});

test('admin allowlist fails closed and matches whole GitHub logins', () => {
	assert.equal(canReadUsage(null, 'owner'), false);
	assert.equal(canReadUsage({login: 'owner', agent: ''}, ''), false);
	assert.equal(canReadUsage({login: 'OWNER', agent: ''}, 'other, owner'), true);
	assert.equal(canReadUsage({login: 'own', agent: ''}, 'owner'), false);
});

test('collection and deletion fail closed independently, including direct calls and stats reads', async () => {
	const db = await migratedDb();
	try {
		await db.exec("INSERT INTO open_index.api_usage VALUES ((now() AT TIME ZONE 'utc')::date - 100, 'GET /api/v1', 'curl', 7)");
		delete process.env.ORI_USAGE_ANALYTICS_ENABLED;
		delete process.env.ORI_USAGE_RETENTION_ENABLED;
		assert.equal(collectionEnabled(), false);
		assert.equal(retentionEnabled(), false);
		await countCall(db, 'GET /api/v1', 'curl');
		await pruneUsage(db);
		await usage(db);
		assert.equal((await db.query('SELECT calls FROM open_index.api_usage')).rows.length, 1);
		process.env.ORI_USAGE_RETENTION_ENABLED = 'true';
		await pruneUsage(db); // retention alone cannot delete while collection is off
		assert.equal((await db.query('SELECT * FROM open_index.api_usage')).rows.length, 1);
		process.env.ORI_USAGE_ANALYTICS_ENABLED = 'true';
		delete process.env.ORI_USAGE_RETENTION_ENABLED;
		await countCall(db, 'GET /api/v1', 'curl'); // collection alone cannot delete
		assert.equal((await db.query('SELECT * FROM open_index.api_usage')).rows.length, 2);
		process.env.ORI_USAGE_RETENTION_ENABLED = 'true';
		await usage(db); // a read never deletes, even when retention is enabled
		assert.equal((await db.query('SELECT * FROM open_index.api_usage')).rows.length, 2);
		process.env.VERCEL_ENV = 'preview';
		await countCall(db, 'GET /api/v1', 'curl');
		await pruneUsage(db);
		assert.equal((await db.query('SELECT * FROM open_index.api_usage')).rows.length, 2);
		delete process.env.VERCEL_ENV;
		await pruneUsage(db); // only both opt-ins on a non-preview runtime allow deletion
		assert.equal((await db.query('SELECT * FROM open_index.api_usage')).rows.length, 1);
	} finally {
		process.env.ORI_USAGE_ANALYTICS_ENABLED = 'true';
		process.env.ORI_USAGE_RETENTION_ENABLED = 'true';
		delete process.env.VERCEL_ENV;
		await db.close();
	}
});

// Runs scripts/prune-usage.ts with these flags against a database URL that holds a password.
const pruneScript = (collection: string, retention: string, environment: string) =>
	spawnSync(process.execPath, ['--experimental-strip-types', new URL('../../scripts/prune-usage.ts', import.meta.url).pathname],
		{ env: { ...process.env, SUPABASE_DB_URL: 'http://[invalid?password=synthetic-secret', ORI_USAGE_ANALYTICS_ENABLED: collection, ORI_USAGE_RETENTION_ENABLED: retention, VERCEL_ENV: environment }, encoding: 'utf8' });

test('scheduler and CLI are inert until both collection and retention are explicitly enabled', () => {
	const workflow = readFileSync(new URL('../../../.github/workflows/usage-retention.yml', import.meta.url), 'utf8');
	assert.match(workflow, /if: \$\{\{ vars\.ORI_USAGE_ANALYTICS_ENABLED == 'true' && vars\.ORI_USAGE_RETENTION_ENABLED == 'true' \}\}/);
	for (const [collection, retention, environment] of [['', '', 'production'], ['', 'true', 'production'], ['true', '', 'production'], ['true', 'true', 'preview']]) {
		const run = pruneScript(collection, retention, environment);
		assert.equal(run.status, 0);
		assert.match(run.stdout, /cleanup is disabled/);
		assert.equal(run.stderr, '');
	}
});

test('retention job does not print database credentials when configuration is invalid', () => {
	const run = pruneScript('true', 'true', 'production');
	assert.equal(run.status, 1);
	assert.match(run.stderr, /Usage retention cleanup failed/);
	assert.doesNotMatch(run.stderr + run.stdout, /synthetic-secret|password=/);
});

test('source-check endpoint does not expand the deployed aggregate metric categories or issue cleanup writes', async () => {
	let queries = 0;
	await countCall({ query: async () => { queries++; throw new Error('new metric category was not approved'); } }, 'POST /api/v1/records/{prefix}/{suffix}/source-checks', 'curl');
	assert.equal(queries, 0);
});
