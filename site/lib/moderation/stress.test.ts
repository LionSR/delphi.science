// Posting regressions with scripted verdicts. Full adversarial fixtures are kept outside this repository.
import { strict as assert } from 'node:assert';
import { before, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { load } from '../records/load.ts';
import { migratedDb } from '../testing.ts';
import type { Moderator, Verdict } from './moderate.ts';
import { submit } from '../records/submit.ts';

let db: PGlite;
const ok: Verdict = { decision: 'ACCEPT', reason: 'Scripted offline fixture.', verification_needed: false };
const who = { login: 'overnight-test', agent: 'Offline test' };
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/1706.03762</id><published>2017-06-12T17:57:34Z</published><title>Attention Is All You Need</title><summary>A research architecture.</summary><author><name>Ashish Vaswani</name></author><arxiv:primary_category term="cs.CL"/></entry></feed>`;
const counts = async () => Promise.all(['entries', 'records', 'topics', 'comments', 'votes', 'submissions'].map(async (t) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM open_index.${t}`)).rows[0].n));
const originalFetch = globalThis.fetch;
before(async () => {
	globalThis.fetch = async () => { throw new Error('Unexpected network request in an offline test'); };
	db = await migratedDb();
	await load(db, [{ id: 'app/stress', source: 'app', title: 'Boundary terms in a finite spin chain', url: 'https://example.org/stress', repo: 'https://github.com/other/stress' }]);
});
after(async () => { globalThis.fetch = originalFetch; await db.close(); });

test('source-fetched agent keys cannot be transmitted to the moderator or enter durable/public records', async () => {
	const before = await counts(); let modelCalls = 0;
	// Deliberately synthetic string, not an existing credential; no credential is created or read.
	const fakeKey = `oik_${'0'.repeat(48)}`;
	const taintedSource: typeof fetch = async () => new Response(atom.replace('A research architecture.', `Private fixture ${fakeKey}`));
	await assert.rejects(submit(db, 'arXiv:1706.03762', who, taintedSource, async () => { modelCalls++; return ok; }), /contains an agent key/);
	assert.equal(modelCalls, 0);
	assert.deepEqual(await counts(), before);
});

test('two accepted submissions competing for the twentieth daily link cannot exceed the public limit', async () => {
	const voter = { login: 'daily-link-race-user', agent: 'Offline test' };
	await db.query(`INSERT INTO open_index.entries (id, entry)
		SELECT 'arxiv/prior-' || n, jsonb_build_object('source', 'arxiv', 'key', 'prior-' || n, 'added_by', $1::text, 'added', $2::text)
		FROM generate_series(1, 19) n`, [voter.login, new Date().toISOString().slice(0, 10)]);
	let checked = 0, release!: () => void;
	const bothChecked = new Promise<void>((resolve) => { release = resolve; });
	const moderate: Moderator = async () => { if (++checked === 2) release(); await bothChecked; return ok; };
	const outcomes = await Promise.allSettled(['1706.03762', '1706.03763'].map((id) => submit(db, `arXiv:${id}`, voter,
		async () => new Response(atom.replaceAll('1706.03762', id)), moderate)));
	assert.equal(checked, 2, 'both pass metadata moderation before either stores a new entry');
	assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
	const refused = outcomes.filter((r) => r.status === 'rejected');
	assert.equal(refused.length, 1); assert.match(String((refused[0] as PromiseRejectedResult).reason), /20 links today/);
	assert.equal((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM open_index.entries WHERE entry->>'added_by' = $1", [voter.login])).rows[0].n, 20);
	assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM open_index.submissions WHERE voter = $1', [voter.login])).rows[0].n, 1);
});
