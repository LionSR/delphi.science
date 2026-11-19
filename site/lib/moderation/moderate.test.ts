// Moderator transport, verdict schema and hold behavior, with scripted verdicts.
// These do not measure a real model's classification quality.
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { deepseek, MODEL, parseVerdict, SYSTEM, verdict, type Post, type Verdict } from './moderate.ts';

const accepted: Verdict = { fix: '', decision: 'ACCEPT', reason: 'A self-contained counterexample addresses the stated hypothesis.', verification_needed: false };
const heldForSource: Verdict = { fix: 'Provide a checkable argument or establish the source.', decision: 'REVIEW_NEEDED', reason: 'Supply a checkable argument or establish the cited source before publication.', verification_needed: true };
const sample: Post = { kind: 'answer', on: 'test question', body: 'For x=0 the asserted strict inequality fails.' };
const completion = (content: unknown, finish_reason: unknown = 'stop') => ({ choices: [{ finish_reason, message: { content } }] });
const stub = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
const held = async (fetcher: typeof fetch) => (await verdict(deepseek('test-placeholder', fetcher), sample)).decision === 'REVIEW_NEEDED';

describe('DeepSeek-only moderation contract (offline)', () => {
	test('uses the official endpoint, current model, JSON mode, no tools and a bounded timeout, sending the post as data', async () => {
		const post: Post = { ...sample, title: 'Boundary terms in an open chain', context: { question: 'Does every square matrix have an inverse?', parent: 'The original calculation retains endpoint terms.' } };
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
			assert.deepEqual(body.messages.map((m: { role: string }) => m.role), ['system', 'user']);
			assert.equal(body.messages[0].content, SYSTEM);
			assert.deepEqual(JSON.parse(body.messages[1].content), post);
			return new Response(JSON.stringify(completion(JSON.stringify(accepted))));
		}) as typeof fetch;
		assert.deepEqual(await deepseek('test-placeholder', fetcher)(post), accepted);
		assert.equal(calls, 1);
	});

	test('a valid verdict, including a hold for verification, comes back intact', async () => {
		for (const valid of [accepted, heldForSource]) assert.deepEqual(await verdict(deepseek('test-placeholder', stub(completion(JSON.stringify(valid)))), sample), valid);
	});

	const malformed: [string, unknown][] = [
		['unknown enum', { ...accepted, decision: 'PUBLISH' }],
		['unresolved verification cannot ACCEPT', { ...accepted, verification_needed: true }],
	];
	for (const [name, value] of malformed) test(`malformed verdict holds publication: ${name}`, async () => {
		assert.throws(() => parseVerdict(value));
		assert.ok(await held(stub(completion(JSON.stringify(value)))));
	});

	test('network and timeout exceptions hold without publishing exception text', async () => {
		const fetcher: typeof fetch = async () => { throw new Error('private-provider-response'); };
		const v = await verdict(deepseek('test-placeholder', fetcher), sample);
		assert.equal(v.decision, 'REVIEW_NEEDED');
		assert.doesNotMatch(v.reason, /private-provider-response/);
	});
});
