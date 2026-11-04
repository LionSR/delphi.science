// Public-source checks with scripted retrievals; no network.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { load } from '#lib/records/load.ts';
import { migratedDb } from '#lib/testing.ts';
import type { Db } from '#lib/db.ts';
import { checkPublicSources, collectPublicSources } from './source-checks.ts';
import type { SourceRetrieval, SourceTarget } from './source-fetch.ts';

const url = 'https://docs.google.com/document/d/abcdefghij1234567890/edit';
const record = 'app/boundary-calculation';
const author = (login: string) => ({ login, agent: 'Offline test' });
const retrieved = async (t: SourceTarget): Promise<SourceRetrieval> => ({
	canonical: t.canonical, adapter: t.adapter, method: 'public-https-v1', status: 'retrieved', reason: 'A bounded public text export was returned.',
	fix: 'Inspect the excerpt against the precise claim.', observed_at: new Date().toISOString(), response_status: 200,
	excerpt: 'For an open chain the telescoping sum retains two endpoint terms.', digest: 'a'.repeat(64),
});

let db: PGlite;
const attempts = async (login: string) => (await db.query<{ reason: string; publish: boolean }>('SELECT reason, publish FROM open_index.moderations WHERE voter=$1', [login])).rows;
before(async () => {
	db = await migratedDb();
	await load(db, [{ id: record, source: 'app', url: 'https://example.org/boundary-calculation', title: 'Boundary terms in a finite chain' }]);
});
after(async () => { await db.close(); });

test('a missing record or an unavailable attempt ledger prevents every retrieval', async () => {
	let calls = 0;
	const noLedger: Db = { query: db.query.bind(db), transaction: async () => { throw new Error('ledger unavailable'); } };
	await assert.rejects(checkPublicSources(noLedger, author('no-ledger'), record, [url], async (t) => { calls++; return retrieved(t); }), /reserve/);
	await assert.rejects(checkPublicSources(db, author('no-record'), 'app/missing', [url], retrieved), /no record/);
	assert.equal(calls, 0);
});

test('preflight reserves one attempt per five-URL batch; later explicit checks are fresh', async () => {
	const who = author('offline-author');
	let calls = 0;
	const fetch = async (t: SourceTarget) => { calls++; return retrieved(t); };
	const a = await checkPublicSources(db, who, record, [url, url.replace('abcdefghij1234567890', 'klmnopqrst1234567890')], fetch);
	assert.equal(a.posted, false); assert.equal(a.results.length, 2);
	assert.equal((await attempts(who.login)).length, 1);
	await checkPublicSources(db, who, record, [url], fetch);
	assert.equal(calls, 3);
	const log = await attempts(who.login);
	assert.equal(log.length, 2);
	assert.ok(log.every((r) => !r.publish && !r.reason.includes('telescoping') && !r.reason.includes('excerpt')));
	assert.match(log[0].reason, /canonical_hash/);
});

test('owner-wide atomic limits include agents and stop retrieval before network activity', async () => {
	const who = author('limited-author');
	await db.query("INSERT INTO open_index.moderations(voter,agent,kind,publish,reason) SELECT $1,'','comment',false,'bounded prior attempt' FROM generate_series(1,29)", [who.login]);
	let calls = 0;
	const fetch = async (t: SourceTarget) => { calls++; return retrieved(t); };
	const result = await Promise.allSettled([checkPublicSources(db, who, record, [url], fetch), checkPublicSources(db, { ...who, agent: 'Other agent' }, record, [url], fetch)]);
	assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1); assert.equal(calls, 1);
	assert.equal((await attempts(who.login)).length, 30);
});

test('an observed failure or identity mismatch cannot become successful source evidence', async () => {
	const who = author('failure-author');
	const a = await checkPublicSources(db, who, record, [url], async (t) => ({ ...await retrieved(t), status: 'not_found', response_status: 404, excerpt: undefined, digest: undefined }));
	assert.equal(a.results[0].status, 'not_found');
	const b = await checkPublicSources(db, who, record, [url], async (t) => ({ ...await retrieved(t), canonical: 'https://docs.google.com/document/d/anotherdocument123' }));
	assert.equal(b.results[0].status, 'unavailable');
});

test('five-URL preflight limit is separate from twelve-reference explicit posting limit', async () => {
	await assert.rejects(checkPublicSources(db, author('batch-author'), record, Array(6).fill(url), retrieved), /one to five/);
	assert.equal((await collectPublicSources(record, Array(12).fill(url), retrieved)).results.length, 12);
	await assert.rejects(collectPublicSources(record, Array(13).fill(url), retrieved), /twelve/);
});

test('aggregate deadline holds slow retrievals and never auto retries', async () => {
	let calls = 0;
	const a = await collectPublicSources(record, [url], async () => { calls++; return await new Promise<SourceRetrieval>(() => {}); }, { deadlineMs: 10 });
	assert.equal(calls, 1); assert.equal(a.results[0].status, 'unavailable');
});
