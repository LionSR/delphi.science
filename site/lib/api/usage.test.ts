// API use counts: counting calls on real Postgres (PGlite) with the migrations as written.
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { countCall, pruneUsage, since, usage } from './usage.ts';
import { canReadUsage } from './usage-admin.ts';
import { migratedDb } from '#lib/testing.ts';

const flagNames = ['ORI_USAGE_ANALYTICS_ENABLED', 'ORI_USAGE_RETENTION_ENABLED', 'VERCEL_ENV'] as const;
const savedFlags = Object.fromEntries(flagNames.map((name) => [name, process.env[name]]));
before(() => {
	process.env.ORI_USAGE_ANALYTICS_ENABLED = 'true';
	process.env.ORI_USAGE_RETENTION_ENABLED = 'true';
	delete process.env.VERCEL_ENV;
});
after(() => { for (const name of flagNames) { if (savedFlags[name] === undefined) delete process.env[name]; else process.env[name] = savedFlags[name]; } });

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

test('admin allowlist fails closed and matches whole GitHub logins', () => {
	assert.equal(canReadUsage(null, 'owner'), false);
	assert.equal(canReadUsage({login: 'owner', agent: ''}, ''), false);
	assert.equal(canReadUsage({login: 'OWNER', agent: ''}, 'other, owner'), true);
	assert.equal(canReadUsage({login: 'own', agent: ''}, 'owner'), false);
});
