// Post feedback classification, offline and on real PGlite posting paths.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { type Moderator } from '#lib/moderation/moderate.ts';
import { postFeedback } from './feedback.ts';
import type { PostInput } from './form-submit.ts';
import { createAgentKey } from '#lib/accounts/keys.ts';
import { allowRouteImports, migratedDb, useDb } from '#lib/testing.ts';

allowRouteImports();
const revision: Moderator = async () => ({ decision: 'REQUEST_REVISION', verification_needed: false, reason: 'Three finite sizes do not establish a thermodynamic gap.', fix: 'Restrict the conclusion to those sizes or give a uniform bound.' });
const input = (overrides: Partial<PostInput> = {}): PostInput => ({ kind: 'question', title: 'What follows from three finite chains?', body: 'Which hypotheses permit a uniform gap bound beyond three finite sizes?', review: false, ...overrides });
const user = { login: 'offline-author', agent: 'test' };

test('an unexpected posting error gives generic feedback and hides the error text', () => {
	const f = postFeedback(new Error('a secret-bearing stack must remain private'));
	assert.equal(f.code, 'posting_unconfirmed');
	assert.doesNotMatch(f.message + f.fix, /secret/);
});

test('actual forum API distinguishes 422 refusal from 503 unavailable and preserves its documented error shape', async () => {
	const pg = await migratedDb();
	const priorFetch = globalThis.fetch, priorKey = process.env.DEEPSEEK_API_KEY;
	try {
		useDb(pg);
		const key = await createAgentKey(pg, user.login, user.agent);
		process.env.DEEPSEEK_API_KEY = 'offline-provider-fixture';
		const { POST } = await import('#app/api/v1/forum/route.ts');
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
	} finally { globalThis.fetch = priorFetch; if (priorKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = priorKey; useDb(); await pg.close(); }
});
