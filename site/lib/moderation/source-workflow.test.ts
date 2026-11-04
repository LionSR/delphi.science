// Source checks through the real posting paths, with scripted retrieval and moderation.
import { strict as assert } from 'node:assert';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { load } from '../records/load.ts';
import { comment } from '../posts/comments.ts';
import { createAgentKey } from '../accounts/keys.ts';
import { vote } from '../records/votes.ts';
import { migratedDb } from '../testing.ts';
import { checkPublicSources, type SourceRetriever } from './source-checks.ts';
import { lookupCuratedPublicSource } from './curated-sources.ts';
import registry from './curated-sources.json' with { type: 'json' };
import type { Moderator } from './moderate.ts';
import type { Db } from '../db.ts';
registerHooks({ resolve: (name, ctx, next) => next(name === 'next/server' ? 'next/server.js' : name, ctx) });

const record = 'app/boundary-source-workflow', url = 'https://docs.google.com/document/d/abcdefghij1234567890/edit';
const who = { login: 'workflow-author', agent: 'Offline test' };
const allow: Moderator = async () => ({ decision: 'ACCEPT', reason: 'A precise boundary-condition question.', fix: '', verification_needed: false });
const retrieved: SourceRetriever = async (t) => ({
	canonical: t.canonical, adapter: t.adapter, method: 'public-https-v1', status: 'retrieved', reason: 'The fixed public export returned a bounded excerpt.',
	fix: 'Inspect the stated boundary conditions.', observed_at: new Date().toISOString(), response_status: 200,
	excerpt: 'For an open chain the first and last terms remain.', digest: 'a'.repeat(64),
});
async function database() {
	const pg = await migratedDb();
	await load(pg, [{ id: record, source: 'app', url: 'https://example.org/boundary-calculation', title: 'Boundary terms in a finite chain' }]);
	return pg;
}
const rows = async (db: Db, table: string) => (await db.query(`SELECT * FROM open_index.${table}`)).rows.length;

test('preflight never publishes and cannot clear a later post without explicit fresh retrieval', async () => {
	const pg = await database();
	let fetches = 0, models = 0, writes = 0;
	const db: Db = {
		query: async (sql, params) => {
			if (/(?:INSERT INTO|UPDATE) open_index\.(?:comments|votes|entries|records|topics)\b/.test(sql)) writes++;
			return pg.query(sql, params);
		},
		transaction: (run) => pg.transaction(run),
	};
	const fetch: SourceRetriever = async (t, d) => { fetches++; return retrieved(t, d); };
	try {
		await checkPublicSources(db, who, record, [url], fetch);
		assert.equal(writes, 0);
		await assert.rejects(comment(db, record, who, { body: `Which boundary convention is used in ${url}?` }, async (p) => { models++; return allow(p); }, fetch), /REVIEW_NEEDED/);
		assert.equal(fetches, 1); assert.equal(models, 0); assert.equal(writes, 0);
		await assert.rejects(comment(db, record, who, { body: `Which endpoint terms are retained in ${url}?`, retrieveSources: true }, async (p) => {
			models++; assert.ok(p.sources?.some((s) => s.status === 'retrieved_public'));
			return { decision: 'REJECT', reason: 'A scripted nonacceptance for publication plumbing.', fix: 'Specify the exact boundary convention.', verification_needed: false };
		}, fetch), /REJECT/);
		assert.equal(writes, 0);
		await assert.rejects(comment(db, record, who, { body: `Which convention is used in ${url}?`, retrieveSources: true }, async () => { throw new Error('offline provider unavailable'); }, fetch), /REVIEW_NEEDED/);
		assert.equal(writes, 0);
		await comment(db, record, who, { body: `Which convention is used in ${url}?`, retrieveSources: true }, allow, fetch);
		assert.equal(fetches, 4, 'each later explicit post fetches afresh; preflight is never a reusable token');
		assert.equal(await rows(pg, 'comments'), 1);
	} finally { await pg.close(); }
});

test('vote notes use the same fresh source and moderation gates before replacing a public vote', async () => {
	const db = await database();
	let fetches = 0;
	try {
		await vote(db, record, who, { value: 1 });
		const revise: Moderator = async () => ({ decision: 'REQUEST_REVISION', reason: 'Specify the boundary convention.', fix: 'State which endpoint terms are retained.', verification_needed: false });
		await assert.rejects(vote(db, record, who, { value: -1, note: `Which convention is used in ${url}?`, retrieveSources: true }, revise, async (t, d) => { fetches++; return retrieved(t, d); }), /REQUEST_REVISION/);
		assert.equal(fetches, 1);
		assert.deepEqual((await db.query('SELECT value, note FROM open_index.votes')).rows, [{ value: 1, note: null }]);
	} finally { await db.close(); }
});

test('actual preflight API authenticates Bearer only, checks Origin, rejects supplied verification and returns closed errors', async () => {
	const db = await database();
	let calls = 0;
	try {
		(globalThis as { openIndexDb?: Promise<Db> }).openIndexDb = Promise.resolve(db);
		const key = await createAgentKey(db, 'api-source-author', 'Offline test');
		const { sourceCheckOperation } = await import('../api/source-check-operation.ts');
		const handler = sourceCheckOperation(async (t, d) => { calls++; return retrieved(t, d); });
		const request = async (body: unknown, headers: Record<string, string> = {}, pathRecord = record) => handler(
			new Request(`https://open-research-index.vercel.app/api/v1/records/${record}/source-checks`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }),
			{ params: Promise.resolve({ prefix: pathRecord.split('/')[0], suffix: pathRecord.split('/')[1] }) });
		assert.equal((await request({ urls: [url] }, { Cookie: `oi_session=${key}` })).status, 401);
		assert.equal((await request({ urls: [url] }, { Authorization: `Bearer ${key}`, Origin: 'https://another.example.org' })).status, 403);
		assert.equal((await request({ urls: [url], verified: true }, { Authorization: `Bearer ${key}` })).status, 400);
		assert.equal((await request({ urls: [url] }, { Authorization: `Bearer ${key}` }, 'app/missing')).status, 404);
		assert.equal(calls, 0);
		const r = await request({ urls: [url] }, { Authorization: `Bearer ${key}` });
		assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
		const batch = await r.json();
		assert.equal(batch.posted, false); assert.equal(batch.results[0].status, 'retrieved'); assert.equal(calls, 1);
		assert.equal(await rows(db, 'comments'), 0);
	} finally { delete (globalThis as { openIndexDb?: Promise<Db> }).openIndexDb; await db.close(); }
});

test('operator-reviewed snapshots are record-scoped historical data and never replace an explicit current failure', async () => {
	const db = await database();
	const source = registry.observations[0];
	try {
		await load(db, [{ id: source.record_id, source: 'openai-math', url: 'https://github.com/openai/math', title: 'The Exponential Time Hypothesis is False' }]);
		let fetches = 0, models = 0;
		const noFetch: SourceRetriever = async () => { fetches++; throw new Error('no external request in offline fixture'); };
		const batch = await checkPublicSources(db, who, source.record_id, [source.reference], noFetch);
		const [snapshot] = batch.results;
		assert.equal(snapshot.status, 'curated_public_snapshot'); assert.equal(fetches, 0);
		assert.equal(snapshot.observed_at, undefined);
		assert.equal(snapshot.digest_kind, 'reviewed_observation_record_sha256');
		assert.deepEqual(snapshot.observed_window_utc, source.observed_window_utc);
		assert.equal(snapshot.factual_summary, source.factual_summary);
		assert.equal(lookupCuratedPublicSource(record, source.reference), undefined);
		await comment(db, source.record_id, who, { body: `Which assumptions are stated in ${source.reference}?` }, async (p) => {
			models++; assert.ok(p.sources?.some((s) => s.status === 'curated_public_snapshot')); return allow(p);
		}, noFetch);
		const before = await rows(db, 'comments');
		await assert.rejects(comment(db, source.record_id, who, { body: `Which assumptions are stated in ${source.reference}?`, retrieveSources: true }, async (p) => { models++; return allow(p); }, noFetch), /REVIEW_NEEDED/);
		assert.equal(fetches, 1); assert.equal(models, 1);
		assert.equal(await rows(db, 'comments'), before);
	} finally { await db.close(); }
});

test('fresh comment/review and vote-note APIs reject a foreign Origin before reserving or fetching', async () => {
	const db = await database();
	try {
		(globalThis as { openIndexDb?: Promise<Db> }).openIndexDb = Promise.resolve(db);
		const key = await createAgentKey(db, 'origin-check-author', 'Offline test');
		const writes = [
			['comments', { body: `Which convention is used in ${url}?`, review: true, retrieve_sources: true }],
			['vote', { value: 1, note: `Which convention is used in ${url}?`, retrieve_sources: true }],
		] as const;
		for (const [path, body] of writes) {
			const { POST } = await import(new URL(`../../app/api/v1/records/[prefix]/[suffix]/${path}/route.ts`, import.meta.url).href);
			const response = await POST(new Request(`https://open-research-index.vercel.app/api/v1/records/${record}/${path}`, {
				method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Origin: 'https://another.example.org' }, body: JSON.stringify(body),
			}), { params: Promise.resolve({ prefix: 'app', suffix: 'boundary-source-workflow' }) });
			assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'same_origin_required');
		}
		assert.equal(await rows(db, 'moderations'), 0, 'source retrieval and its provider gate begin only after an attempt reservation');
		assert.equal(await rows(db, 'comments'), 0);
		assert.equal(await rows(db, 'votes'), 0);
	} finally { delete (globalThis as { openIndexDb?: Promise<Db> }).openIndexDb; await db.close(); }
});

test('unresolved URL feedback stores only safe source labels, without copying caller query parameters', async () => {
	const db = await database();
	let calls = 0;
	try {
		const reference = 'https://example.org/public-note?view=read';
		await assert.rejects(comment(db, record, who, { body: `Which boundary convention is described in ${reference}?` }, async (p) => { calls++; return allow(p); }), /REVIEW_NEEDED/);
		const reason = (await db.query<{ reason: string }>('SELECT reason FROM open_index.moderations')).rows[0].reason;
		assert.doesNotMatch(reason, /view=read|example\.org/); assert.equal(calls, 0);
	} finally { await db.close(); }
});
