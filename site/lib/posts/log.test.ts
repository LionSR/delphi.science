// The log's events (supabase/migrations/20261117130000_events.sql) and its query: one event per record and per post,
// none on a reload, the cursor kept across the migration, and each term of the query.
import { strict as assert } from 'node:assert';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import type { Moderator } from '#lib/moderation/moderate.ts';
import { load, type Item } from '#lib/records/load.ts';
import { migratedDb } from '#lib/testing.ts';
import { comment, post } from './comments.ts';
import { editPost } from './edit.ts';
import { startTopic } from './forum.ts';
import { log, NeedsReader } from './log.ts';

const yes: Moderator = async () => ({ decision: 'ACCEPT', reason: 'Private fixture accepted.', verification_needed: false, fix: '' });
const item = (id: string, more: Partial<Item> = {}): Item => ({ id, source: id.split('/')[0], title: `On ${id}`, url: `https://example.org/${id}`,
	summary: 'We bound the endpoint terms of an open chain.', published: '2026-11-01', ...more });
const QP = item('arxiv/2611.00001', { title: 'Entanglement in open chains', subject: 'quant-ph', division: 'physics' });
const NT = item('arxiv/2611.00002', { title: 'Zero-free regions for L-functions', subject: 'math.NT', division: 'math', formalized: true });
const APP = item('app/APP-1', { title: 'A verified lemma', subject: 'math.CO', division: 'math' });
const EVENTS = 'SELECT seq::int, kind, path, voter FROM open_index.events ORDER BY seq';
const events = async (db: PGlite) => (await db.query<{ seq: number; kind: string; path: string; voter: string }>(EVENTS)).rows;
const ada = { login: 'Ada', agent: '' }, bob = { login: 'bob', agent: 'Codex' }, eve = { login: 'eve', agent: '' };

describe('events', () => {
	test('a post gets one event with its kind and author; an edit adds none, and a deleted post leaves the log', async () => {
		const db = await migratedDb();
		await load(db, [QP, NT]);
		const review = await comment(db, QP.id, ada, { body: 'Section 2 holds for open boundary conditions only.', review: true }, yes);
		const reply = await comment(db, QP.id, bob, { body: 'With periodic ones the constant doubles.', parent: review.id }, yes);
		const topic = await startTopic(db, ada, { title: 'Does the endpoint term vanish?', body: `It does in ${NT.id}, but why?` }, yes);
		const answer = await post(db, { topic: topic.id }, bob, { body: 'By the symmetry of the chain.' }, yes);
		const remark = await post(db, { topic: topic.id }, eve, { body: 'Only for even length.', parent: answer.id }, yes);
		const second = await post(db, { topic: topic.id }, eve, { body: 'A second answer: by direct computation.' }, yes);
		const question = topic.question.id;
		assert.deepEqual((await events(db)).slice(2), [
			{ seq: 3, kind: 'review', path: `${QP.id}/${review.id}`, voter: 'Ada' }, { seq: 4, kind: 'comment', path: `${QP.id}/${reply.id}`, voter: 'bob' },
			{ seq: 5, kind: 'question', path: `forum/${topic.id}/${question}`, voter: 'Ada' }, { seq: 6, kind: 'answer', path: `forum/${topic.id}/${answer.id}`, voter: 'bob' },
			{ seq: 7, kind: 'comment', path: `forum/${topic.id}/${remark.id}`, voter: 'eve' }, { seq: 8, kind: 'answer', path: `forum/${topic.id}/${second.id}`, voter: 'eve' },
		]);
		// The log shows what the post says now: rows only point.
		const revision = (await log(db, null, { record: QP.id }, { since: 0 })).entries[0].revision;
		await editPost(db, review.id, ada, { body: 'Section 2 holds for open boundary conditions only; see (4).', revision }, yes);
		assert.equal((await events(db)).length, 8);
		const thread = (await log(db, null, { record: QP.id }, { since: 0 })).entries;
		assert.deepEqual(thread.map((e) => [e.seq, e.kind, e.parent, e.body]), [
			[3, 'review', null, 'Section 2 holds for open boundary conditions only; see (4).'], [4, 'comment', `${QP.id}/${review.id}`, 'With periodic ones the constant doubles.']]);
		await db.query('DELETE FROM open_index.comments WHERE id = $1', [remark.id]);
		assert.equal((await events(db)).length, 8, 'the row stays');
		assert.deepEqual((await log(db, null, { topic: topic.id }, { since: 0 })).entries.map((e) => e.seq), [5, 6, 8]);
		await db.close();
	});
});

describe('the log query', () => {
	let db: PGlite;
	let paths: Record<string, string>;
	// `reader` is who is asking (log's second argument): nobody, unless a test names one.
	const found = async (q: string, { reader = null, ...opts }: Parameters<typeof log>[3] & { reader?: { login: string } | null } = {}, scope: Parameters<typeof log>[2] = {}) =>
		(await log(db, reader?.login ?? null, scope, { since: 0, q, ...opts })).entries.map((e) => Object.entries(paths).find(([, p]) => p === e.path)?.[0] ?? e.path);

	before(async () => {
		db = await migratedDb();
		await load(db, [QP, NT, APP]);
		const onQp = await comment(db, QP.id, ada, { body: 'The area law here is sharp.' }, yes);
		const reply = await comment(db, QP.id, bob, { body: 'It fails at criticality.', parent: onQp.id }, yes);
		const review = await comment(db, APP.id, bob, { body: `The lemma is the one in ${NT.id}, restated.`, review: true }, yes);
		const topic = await startTopic(db, ada, { title: 'Is grokking a phase transition?', body: `Compare ${QP.id} on entanglement.`, section: 'methods' }, yes);
		const answer = await post(db, { topic: topic.id }, bob, { body: 'The order parameter is not defined.' }, yes);
		const remark = await post(db, { topic: topic.id }, eve, { body: 'It is, in the mean-field limit.', parent: answer.id }, yes);
		const own = await post(db, { topic: topic.id }, ada, { body: 'Thanks; I will read the mean-field paper.', parent: answer.id }, yes);
		const elsewhere = await startTopic(db, eve, { title: 'A topic nobody answered', body: 'No record is named here.' }, yes);
		const at = (thread: string, p: { id: number }) => `${thread}/${p.id}`;
		paths = { qp: QP.id, nt: NT.id, app: APP.id, onQp: at(QP.id, onQp), reply: at(QP.id, reply), review: at(APP.id, review), question: at(`forum/${topic.id}`, topic.question),
			answer: at(`forum/${topic.id}`, answer), remark: at(`forum/${topic.id}`, remark), own: at(`forum/${topic.id}`, own), elsewhere: at(`forum/${elsewhere.id}`, elsewhere.question) };
	});

	test('no query is everything, in order', async () => {
		assert.deepEqual(await found(''), ['qp', 'nt', 'app', 'onQp', 'reply', 'review', 'question', 'answer', 'remark', 'own', 'elsewhere']);
		assert.deepEqual((await log(db, null, {}, { limit: 3 })).entries.map((e) => e.path), [paths.elsewhere, paths.own, paths.remark]);
	});

	test('section is a boolean predicate on public topics and composes with other log terms', async () => {
		const methods = ['question', 'answer', 'remark', 'own'];
		assert.deepEqual(await found('section:methods'), methods);
		assert.deepEqual(await found('cat:quant-ph'), ['qp', 'onQp', 'reply', ...methods]);
		assert.deepEqual(await found(`re:${QP.id}`), ['onQp', 'reply', 'question']);
		assert.deepEqual(await found('', {}, { forum: true, section: 'methods' }), methods);
		assert.deepEqual(await found('NOT section:methods'), ['qp', 'nt', 'app', 'onQp', 'reply', 'review', 'elsewhere']);
		assert.deepEqual(await found('(section:methods OR section:general) kind:question'), ['question', 'elsewhere']);
		assert.deepEqual(await found('section:methods domain:quant-ph by:@bob'), ['answer']);
		assert.deepEqual(await found('section:methods NOT cat:quant-ph'), []);
		for (const q of ['section:', 'section:unknown', 'section:GENERAL']) {
			await assert.rejects(found(q), /unknown forum section/);
		}
	});

	test('to: is what others addressed to a person: replies to their posts, and posts in their topics', async () => {
		// Ada: bob replied to her comment, and bob and eve posted in her topic. Her own posts there are not her inbox.
		assert.deepEqual(await found('to:@ada'), ['reply', 'answer', 'remark']);
		assert.deepEqual(await found('to:Ada'), ['reply', 'answer', 'remark']);
		// Bob: eve and ada commented on his answer.
		assert.deepEqual(await found('to:@bob'), ['remark', 'own']);
		assert.deepEqual(await found('to:@eve'), []);
		assert.deepEqual(await found('to:@ada kind:answer'), ['answer']);
		await assert.rejects(found('to:@'), /to: needs a GitHub login/);
	});
	test('@me is the caller, and needs one', async () => {
		assert.deepEqual(await found('to:@me', { reader: { login: 'Ada' } }), ['reply', 'answer', 'remark']);
		assert.deepEqual(await found('by:@me', { reader: { login: 'bob' } }), ['reply', 'review', 'answer']);
		for (const q of ['to:@me', 'by:@me', 'kind:answer OR to:me']) {
			await assert.rejects(found(q), (e) => e instanceof NeedsReader && e.status === 401 && e.code === 'sign_in', q);
			await assert.rejects(found(q, { reader: null }), NeedsReader, q);
		}
	});
});
