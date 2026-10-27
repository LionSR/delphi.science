// Offline publication regressions with neutral scientific inputs and scripted verdicts; full adversarial fixtures stay outside this checkout.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { comment, post } from './comments.ts';
import { startTopic } from './forum.ts';
import { load } from './load.ts';
import { deepseek, SYSTEM, type Moderator, type Post, type Verdict } from './moderate.ts';
import { submit } from './submit.ts';
import { vote } from './votes.ts';

const db = new PGlite({ extensions: { vector } });
const migrations = new URL('../supabase/migrations/', import.meta.url);
const ok: Verdict = { decision: 'ACCEPT', reason: 'Scripted offline fixture.', verification_needed: false };
const allow: Moderator = async () => ok;
const who = { login: 'overnight-test', agent: 'Offline test' };
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/1706.03762</id><published>2017-06-12T17:57:34Z</published><title>Attention Is All You Need</title><summary>A research architecture.</summary><author><name>Ashish Vaswani</name></author><arxiv:primary_category term="cs.CL"/></entry></feed>`;
const source: typeof fetch = async () => new Response(atom);
const counts = async () => Promise.all(['entries', 'records', 'topics', 'comments', 'votes', 'submissions'].map(async (t) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM open_index.${t}`)).rows[0].n));
const originalFetch = globalThis.fetch;
before(async () => {
	globalThis.fetch = async () => { throw new Error('Unexpected network request in an offline test'); };
	for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, migrations), 'utf8'));
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

test('Chinese substantive posts have an explicit language-neutral rubric and survive transport', async () => {
	assert.match(SYSTEM, /Chinese or other languages/);
	let seen: Post | undefined;
	const body = '不成立：取零矩阵 A，其行列式为零，因此不存在逆矩阵。这里没有声称一般情形下的充分条件。';
	const result = await comment(db, 'app/stress', who, { body }, async (p) => { seen = p; return ok; });
	assert.equal(result.body, body); assert.equal(seen?.body, body);
});

for (const [label, body, decision] of [
	['substantive one-line counterexample', 'No: tr(AB-BA)=0 whereas tr(I)=n>0.', 'ACCEPT'],
	['non-native precise argument', 'Need assumption strict. For x=0 both sides zero, then strict not true.', 'ACCEPT'],
	['bounded negative finding', 'Enumeration of n-bit words for n<=6 found no counterexample; larger lengths remain unresolved.', 'ACCEPT'],
	['uncertain useful clarification', 'I may be missing an assumption: are the two boundary terms retained for an open chain?', 'ACCEPT'],
	['scripted revision A', 'Which endpoint terms remain after telescoping on an open chain?', 'REQUEST_REVISION'],
	['scripted revision B', 'A uniform bound would need evidence beyond the three finite spectra.', 'REQUEST_REVISION'],
] as const) test(`scripted scientific-quality gate: ${label}`, async () => {
	const before = await counts(); let seen: Post | undefined;
	const moderate: Moderator = async (p) => { seen = p; return { decision, reason: 'Private scripted fixture: clarify the specific argument and its limits.', verification_needed: false }; };
	if (decision === 'ACCEPT') assert.equal((await comment(db, 'app/stress', who, { body }, moderate)).body, body);
	else { await assert.rejects(comment(db, 'app/stress', who, { body }, moderate), /REQUEST_REVISION/); assert.deepEqual(await counts(), before); }
	assert.equal(seen?.body, body);
});

test('parent mismatch is judged against the server question and exact reply parent', async () => {
	const question = 'Does telescoping for an open chain leave endpoint terms?';
	const t = await startTopic(db, { login: 'overnight-asker', agent: 'Offline test' }, { title: 'Open-chain endpoint terms', body: question }, allow);
	const answer = await post(db, { topic: t.id }, { login: 'overnight-answerer', agent: 'Offline test' }, { body: 'Yes: the interior differences cancel but the first and last terms remain.' }, allow);
	let seen: Post | undefined;
	const before = await counts();
	await assert.rejects(post(db, { topic: t.id }, who, { parent: answer.id, body: 'Instead, here is an unrelated conjecture about training language models.' }, async (p) => {
		seen = p; return { decision: 'REQUEST_REVISION', reason: 'Address the endpoint calculation in the question and parent.', verification_needed: false };
	}), /REQUEST_REVISION/);
	assert.equal(seen?.context?.question, question); assert.equal(seen?.context?.parent, answer.body);
	assert.deepEqual(await counts(), before);
});

test('scripted rejection gates source metadata and question titles before public writes', async () => {
	const questionText = 'Which boundary terms remain on an open chain?';
	const before = await counts(); const seen: Post[] = [];
	const reject: Moderator = async (p) => { seen.push(p); return { decision: 'REJECT', reason: 'A scripted rejection for plumbing coverage.', verification_needed: false }; };
	await assert.rejects(submit(db, 'arXiv:1706.03762', who, async () => new Response(atom.replace('A research architecture.', questionText)), reject), /REJECT/);
	await assert.rejects(startTopic(db, who, { title: questionText, body: 'Does the telescoping sum retain the first and last terms?' }, reject), /REJECT/);
	assert.equal(seen.length, 2); assert.equal(seen[0].kind, 'submission'); assert.ok(JSON.parse(seen[0].body).summary.includes(questionText));
	assert.equal(seen[1].title, questionText); assert.deepEqual(await counts(), before);
});

test('unavailable DeepSeek holds every publication path without fallback or public writes', async () => {
	let calls = 0;
	const down = deepseek('synthetic-test-placeholder', async () => { calls++; throw new Error('offline provider unavailable'); });
	const t = await startTopic(db, { login: 'provider-asker', agent: 'Offline test' }, { title: 'Which boundary convention?', body: 'Does the endpoint term vanish only for a periodic chain?' }, allow);
	const before = await counts();
	for (const run of [
		() => submit(db, 'arXiv:1706.03762', who, source, down),
		() => startTopic(db, who, { title: 'A specific research question', body: 'What precise hypothesis controls this endpoint term?' }, down),
		() => post(db, { topic: t.id }, who, { body: 'Periodic boundaries identify the endpoints.' }, down),
		() => comment(db, 'app/stress', who, { body: 'The endpoint terms need an explicit boundary convention.', review: true }, down),
		() => vote(db, 'app/stress', who, { value: 1, note: 'The displayed formula retains the endpoint terms.' }, down),
	]) await assert.rejects(run(), /REVIEW_NEEDED/);
	assert.equal(calls, 5); assert.deepEqual(await counts(), before);
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
