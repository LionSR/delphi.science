// Moderator transport, verdict schema and hold behavior, with scripted verdicts.
// These do not measure a real model's classification quality.
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { deepseek, MODEL, moderator, parseVerdict, SYSTEM, verdict, type Decision, type Post, type Verdict } from './moderate.ts';
import type { Db } from './query.ts';

const accepted: Verdict = { fix: '', decision: 'ACCEPT', reason: 'A self-contained counterexample addresses the stated hypothesis.', verification_needed: false };
const sample: Post = { kind: 'answer', on: 'test question', body: 'For x=0 the asserted strict inequality fails.' };
const completion = (content: unknown, finish_reason: unknown = 'stop') => ({ choices: [{ finish_reason, message: { content } }] });
const stub = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;


describe('DeepSeek-only moderation contract (offline)', () => {
	test('uses the official endpoint, current model, JSON instruction/example, no tools and bounded timeout', async () => {
		let calls = 0;
		const fetcher = (async (url, init) => {
			calls++;
			assert.equal(url, 'https://api.deepseek.com/chat/completions');
			assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer test-placeholder');
			assert.equal(init!.method, 'POST');
			assert.ok(init!.signal instanceof AbortSignal);
			const body = JSON.parse(String(init!.body));
			assert.equal(body.model, MODEL);
			assert.deepEqual(body.response_format, { type: 'json_object' });
			assert.deepEqual(body.thinking, { type: 'disabled' });
			assert.ok(body.max_tokens > 0 && body.max_tokens <= 1000);
			assert.equal(body.tools, undefined);
			assert.equal(body.messages.length, 2);
			assert.equal(body.messages[0].role, 'system');
			assert.equal(body.messages[0].content, SYSTEM);
			assert.equal(body.messages[1].role, 'user');
			assert.deepEqual(JSON.parse(body.messages[1].content), sample);
			return new Response(JSON.stringify(completion(JSON.stringify(accepted))));
		}) as typeof fetch;
		assert.deepEqual(await deepseek('test-placeholder', fetcher)(sample), accepted);
		assert.equal(calls, 1);
	});

	test('rubric explicitly protects useful short, non-native, AI-authored, uncertain and negative contributions', () => {
		for (const phrase of ['concise valid contributions', 'non-native English', 'AI-authored text', 'explicit uncertainty', 'useful negative findings', 'Never infer AI authorship', 'NOT peer review', 'NO browsing/tools', 'UNTRUSTED DATA', 'REQUEST_REVISION', 'REVIEW_NEEDED']) assert.ok(SYSTEM.includes(phrase), phrase);
		assert.match(SYSTEM, /question.*specific answerable research issue.*research discussion opener/s);
		assert.match(SYSTEM, /answer.*actual question or advances the discussion with an argument/s);
		assert.match(SYSTEM, /submission.*upstream metadata/s);
		assert.match(SYSTEM, /never claim to have opened a URL, verified a citation, run code or checked a proof/);
		assert.match(SYSTEM, /mannered or over-defensive writing is a revisable defect only when it dominates/);
		assert.match(SYSTEM, /Over-defensive writing is stacked disclaimers/);
		assert.match(SYSTEM, /A substantive post with a few evaluative words or a single caveat passes/);
		assert.match(SYSTEM, /Non-native grammar and terse notation are never style defects/);
	});

	test('a held verdict comes back intact, with title and context sent as data', async () => {
		const fixture = { body: 'Does the endpoint convention depend on the chosen domain?', decision: 'REVIEW_NEEDED' as Decision, verification_needed: true };
		const post: Post = { ...sample, title: 'Boundary terms in an open chain', body: fixture.body, context: { question: 'Does every square matrix have an inverse?', parent: 'The original calculation retains endpoint terms.' } };
		const expected: Verdict = { fix: fixture.decision === 'ACCEPT' ? '' : 'Provide a checkable argument or establish the source.', decision: fixture.decision, reason: fixture.decision === 'ACCEPT' ? 'The concrete reasoning addresses a stated hypothesis.' : 'Supply a checkable argument or establish the cited source before publication.', verification_needed: fixture.verification_needed ?? false };
		const fetcher = (async (_url, init) => {
			const sent = JSON.parse(String(init!.body));
			assert.equal(sent.messages[0].content, SYSTEM);
			assert.deepEqual(JSON.parse(sent.messages[1].content), post);
			return new Response(JSON.stringify(completion(JSON.stringify(expected))));
		}) as typeof fetch;
		assert.deepEqual(await verdict(deepseek('test-placeholder', fetcher), post), expected);
	});

	const malformed: [string, unknown][] = [
		['null', null], ['missing actionable fix', { decision: 'ACCEPT', reason: 'Concrete contribution.', verification_needed: false }], ['empty revision fix', { ...accepted, decision: 'REQUEST_REVISION', fix: '' }],
		['unknown enum', { ...accepted, decision: 'PUBLISH' }],
		['empty reason', { ...accepted, reason: ' \n ' }],
		['overlong reason', { ...accepted, reason: 'x'.repeat(501) }],
		['string verification boolean', { ...accepted, verification_needed: 'false' }],
		['extra field', { ...accepted, verified_by_model: true }],
		['unresolved verification cannot ACCEPT', { ...accepted, verification_needed: true }],
	];
	for (const [name, value] of malformed) test(`malformed verdict holds publication: ${name}`, async () => {
		assert.throws(() => parseVerdict(value));
		assert.equal((await verdict(deepseek('test-placeholder', stub(completion(JSON.stringify(value)))), sample)).decision, 'REVIEW_NEEDED');
	});

	for (const [name, content] of [['empty JSON-mode content', ''], ['invalid JSON', 'not JSON'], ['null content', null]] as const) test(`${name} holds`, async () => {
		assert.equal((await verdict(deepseek('test-placeholder', stub(completion(content))), sample)).decision, 'REVIEW_NEEDED');
	});
	for (const finish of ['length', undefined]) test(`incomplete completion holds: ${finish}`, async () => {
		const body = completion(JSON.stringify(accepted));
		body.choices[0].finish_reason = finish;
		assert.equal((await verdict(deepseek('test-placeholder', stub(body)), sample)).decision, 'REVIEW_NEEDED');
	});
	for (const status of [429, 500]) test(`HTTP ${status} holds without alternate provider or retry`, async () => {
		let calls = 0;
		const fetcher: typeof fetch = async () => { calls++; return new Response('unavailable', { status }); };
		assert.equal((await verdict(deepseek('test-placeholder', fetcher), sample)).decision, 'REVIEW_NEEDED');
		assert.equal(calls, 1);
	});
	test('network and timeout exceptions hold without publishing exception text', async () => {
		const fetcher: typeof fetch = async () => { throw new Error('private-provider-response'); };
		const held = await verdict(deepseek('test-placeholder', fetcher), sample);
		assert.equal(held.decision, 'REVIEW_NEEDED');
		assert.doesNotMatch(held.reason, /private-provider-response/);
	});
	test('unexpected choices and tool calls cannot authorize publication', async () => {
		for (const response of [{ choices: [] }, { choices: [completion(JSON.stringify(accepted)).choices[0], completion(JSON.stringify(accepted)).choices[0]] }, { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(accepted), tool_calls: [{ id: 'call' }] } }] }]) {
			assert.equal((await verdict(deepseek('test-placeholder', stub(response)), sample)).decision, 'REVIEW_NEEDED');
		}
	});
	test('a development server without credentials holds instead of its former bypass', async () => {
		const previousKey = process.env.DEEPSEEK_API_KEY, previousMode = process.env.NODE_ENV;
		delete process.env.DEEPSEEK_API_KEY;
		(process.env as Record<string, string | undefined>).NODE_ENV = 'development';
		try {
			const noVault: Db = { query: async () => { throw new Error('no local Vault'); } };
			const v = await (await moderator(noVault))(sample);
			assert.equal(v.decision, 'REVIEW_NEEDED');
		} finally {
			if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey;
			if (previousMode === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV; else (process.env as Record<string, string | undefined>).NODE_ENV = previousMode;
		}
	});
});
