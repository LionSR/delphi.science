// Post feedback classification, offline and on real PGlite posting paths.
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { type Moderator } from '../moderation/moderate.ts';
import { ModerationError, postFeedback, holdFeedbackText } from './feedback.ts';
import { submitPostForm, type PostInput } from './form-submit.ts';
import { createAgentKey } from '../accounts/keys.ts';
import { load } from '../records/load.ts';
import type { Db } from '../db.ts';

registerHooks({ resolve: (name, ctx, next) => next(name === 'next/server' ? 'next/server.js' : name, ctx) });
const accept: Moderator = async () => ({ decision: 'ACCEPT', verification_needed: false, reason: 'Self-contained scoped argument.', fix: '' });
const revision: Moderator = async () => ({ decision: 'REQUEST_REVISION', verification_needed: false, reason: 'Three finite sizes do not establish a thermodynamic gap.', fix: 'Restrict the conclusion to those sizes or give a uniform bound.' });
const broken: Moderator = async () => { throw new Error('private connection details must not be exposed'); };
const input = (overrides: Partial<PostInput> = {}): PostInput => ({ kind: 'question', title: 'What follows from three finite chains?', body: 'Which hypotheses permit a uniform gap bound beyond three finite sizes?', review: false, ...overrides });
const user = { login: 'offline-author', agent: 'test' };

test('an unexpected posting error gives generic feedback and hides the error text', () => {
	const f = postFeedback(new Error('a secret-bearing stack must remain private'));
	assert.equal(f.code, 'posting_unconfirmed');
	assert.doesNotMatch(f.message + f.fix, /secret/);
});

test('refusal/service failure expose reason+fix and create no public rows; revision then acceptance is retry-safe', async () => {
	const pg = new PGlite({ extensions: { vector } });
	try {
		const dir = new URL('../../supabase/migrations/', import.meta.url);
		for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL(name, dir), 'utf8'));
		await load(pg, [{ id: 'arxiv/1706.03762', source: 'arxiv', url: 'https://arxiv.org/abs/1706.03762', title: 'An indexed paper' }]);
		let publicWrites = 0;
		const d: Db = { transaction: (f) => pg.transaction(f), query: async (sql, params) => {
			if (/INSERT INTO open_index\.(?:topics|comments)\b/.test(sql)) publicWrites++;
			return pg.query(sql, params);
		} };
		for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(submitPostForm(d, user, input(), revision), (e) => {
			const f = postFeedback(e); assert.equal(f.code, 'moderation_rejected'); assert.match(f.message, /Three finite sizes/); assert.match(f.fix, /uniform bound/); return true;
		});
		await assert.rejects(submitPostForm(d, user, input(), broken), (e) => postFeedback(e).code === 'moderation_unavailable');
		for (const [decision, code] of [['REJECT', 'moderation_rejected'], ['REVIEW_NEEDED', 'moderation_review_needed']] as const) {
			// Words such as 'unavailable' do not classify service failures: trusted server state does.
			const scripted: Moderator = async () => ({ decision, verification_needed: decision === 'REVIEW_NEEDED', reason: 'The source is unavailable for independent checking.', fix: 'Provide independently checked evidence or a self-contained argument.' });
			await assert.rejects(submitPostForm(d, user, input(), scripted), (e) => {
				assert.equal(postFeedback(e).code, code);
				assert.equal((e as ModerationError).status, decision === 'REJECT' ? 422 : 409); return true;
			});
		}
		const priorKey = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
		try {
			await assert.rejects(submitPostForm(d, user, input()), (e) => e instanceof ModerationError && e.status === 503 && e.code === 'moderation_unavailable');
		} finally { if (priorKey !== undefined) process.env.DEEPSEEK_API_KEY = priorKey; }
		assert.equal(publicWrites, 0, 'rejected text and even its title never enter public tables');
		assert.equal((await pg.query('SELECT * FROM open_index.topics')).rows.length, 0);
		assert.equal((await pg.query('SELECT * FROM open_index.comments')).rows.length, 0);
		const link = 'arXiv:2601.90000';
		const upstream: typeof fetch = async () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2601.90000</id><published>2026-01-01</published><title>Finite-chain boundary computations</title><summary>A reproducible scoped computation.</summary><author><name>Offline Author</name></author></entry></feed>');
		await assert.rejects(submitPostForm(d, user, input({ kind: 'submission', body: link }), revision, upstream), (e) => {
			assert.match(postFeedback(e).fix, /uniform bound/); return true;
		});
		const linkLocation = await submitPostForm(d, user, input({ kind: 'submission', body: link }), accept, upstream);
		assert.equal(linkLocation, '/r/arxiv/2601.90000');
		const revised = input({ body: 'Positive gaps at n=4,6,8 show only that those systems are gapped, not a uniform infinite-size bound.' });
		const location = await submitPostForm(d, user, revised, accept);
		assert.match(location, /^\/forum\/\d+$/);
		assert.equal(await submitPostForm(d, user, revised, broken), location, 'retry after a lost success reuses the same own post without another model call');
		assert.equal((await pg.query('SELECT * FROM open_index.topics')).rows.length, 1);
		const topic = Number(location.split('/').at(-1));
		const answerBody = 'A finite set of spectra gives no bound on the untested sizes.';
		const answerLocation = await submitPostForm(d, user, input({ kind: 'answer', topic, body: answerBody }), accept);
		assert.ok(answerLocation.includes('#p'));
		const newQuestion = await submitPostForm(d, user, input({ body: answerBody }), accept);
		assert.notEqual(newQuestion, location, 'a self-answer is not mistaken for the original question');
		const repeatedQuestionAsAnswer = await submitPostForm(d, user, input({ kind: 'answer', topic, body: revised.body }), accept);
		assert.notEqual(repeatedQuestionAsAnswer, `${location}#p1`, 'a question is never falsely acknowledged as an answer');
	} finally { await pg.close(); }
});

test('actual forum API distinguishes 422 refusal from 503 unavailable and preserves its documented error shape', async () => {
	const pg = new PGlite({ extensions: { vector } });
	const priorFetch = globalThis.fetch, priorKey = process.env.DEEPSEEK_API_KEY;
	try {
		const dir = new URL('../../supabase/migrations/', import.meta.url);
		for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL(name, dir), 'utf8'));
		(globalThis as { openIndexDb?: Promise<unknown> }).openIndexDb = Promise.resolve(pg);
		const key = await createAgentKey(pg, user.login, user.agent);
		process.env.DEEPSEEK_API_KEY = 'offline-provider-fixture';
		const { POST } = await import('../../app/api/v1/forum/route.ts');
		let unavailable = false;
		globalThis.fetch = (async () => {
			if (unavailable) return new Response('down', { status: 503 });
			return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(await revision({ kind: 'question', on: 'private fixture', body: 'x' })) } }] });
		}) as typeof fetch;
		for (const mode of [false, true]) {
			unavailable = mode;
			const r = await POST(new Request('http://offline/api/v1/forum', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: input().title, body: input().body }) }));
			assert.equal(r.status, mode ? 503 : 422);
			assert.equal(r.headers.get('cache-control'), 'private, no-store');
			const b = await r.json(); assert.deepEqual(Object.keys(b.error).sort(), ['code', 'fix', 'message']);
			assert.equal(b.error.code, mode ? 'moderation_unavailable' : 'moderation_rejected');
			assert.ok(b.error.fix.length > 0);
		}
		assert.equal((await pg.query('SELECT * FROM open_index.topics')).rows.length, 0);
		assert.equal((await pg.query('SELECT * FROM open_index.comments')).rows.length, 0);
	} finally { globalThis.fetch = priorFetch; if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = priorKey; delete (globalThis as { openIndexDb?: unknown }).openIndexDb; await pg.close(); }
});


test('ordinary hold feedback is one concise actionable explanation, without verification machinery', () => {
 const source=holdFeedbackText({code:'moderation_review_needed',message:'not posted: REVIEW_NEEDED: A cited source remains unresolved: https://example.org/public (unindexed/unrequested). Missing material is not proof a claim is false.',fix:'Detailed API guidance remains separate.'});
 assert.ok(source.length<250);assert.doesNotMatch(source,/unindexed|https:|batch|retrieve_sources|Check public sources/);
 const proof=holdFeedbackText({code:'moderation_review_needed',message:'not posted: REVIEW_NEEDED: The claimed bound needs an independent check.',fix:'Supply scoped evidence.'});
 assert.match(proof,/claimed bound needs an independent check/);
});
