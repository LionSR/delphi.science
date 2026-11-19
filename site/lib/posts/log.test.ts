// The log's events (supabase/migrations/20261117130000_events.sql) and its query: one event per record and per post,
// none on a reload, the cursor kept across the migration, and each term of the query.
import { strict as assert } from 'node:assert';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import type { Moderator } from '#lib/moderation/moderate.ts';
import { load, type Item } from '#lib/records/load.ts';
import { COLUMNS, row } from '#lib/records/load.ts';
import { emptyDb, migratedDb, migrations } from '#lib/testing.ts';
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
	test('a record gets one event when it first enters the index, and none when it is loaded again or changes', async () => {
		const db = await migratedDb();
		assert.equal(await load(db, [QP, NT]), 2);
		assert.deepEqual(await events(db), [{ seq: 1, kind: 'record', path: QP.id, voter: '' }, { seq: 2, kind: 'record', path: NT.id, voter: '' }]);
		// The same build again writes no row; a changed record is an update; a new one is the only new event.
		assert.equal(await load(db, [QP, NT]), 0);
		assert.equal(await load(db, [{ ...QP, title: 'Entanglement in open chains, revised' }, NT, APP]), 2);
		assert.deepEqual((await events(db)).map((e) => e.path), [QP.id, NT.id, APP.id]);
		// However the row is written: a link submitted on the site inserts it directly, and a later build upserts it.
		const direct = item('web/0123456789ab');
		const insert = `INSERT INTO open_index.records (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`;
		await db.query(insert, await row(direct));
		await db.query(insert, await row(direct));
		assert.equal(await load(db, [QP, NT, APP, direct]), 1, 'the build restores the first title');
		assert.deepEqual((await events(db)).map((e) => e.path), [QP.id, NT.id, APP.id, direct.id]);
		// A record removed and listed again keeps its first event; while it is gone the log does not show it.
		await db.query('DELETE FROM open_index.records WHERE id = $1', [APP.id]);
		assert.deepEqual((await log(db, null, { source: 'app' })).entries, []);
		await load(db, [APP]);
		assert.deepEqual((await events(db)).map((e) => e.path), [QP.id, NT.id, APP.id, direct.id]);
		assert.deepEqual((await log(db, null, { source: 'app' })).entries.map((e) => [e.seq, e.path]), [[3, APP.id]]);
		await db.close();
	});

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

	test('the migration, over rows that were there: posts keep their numbers as seqs, records come before the log', async () => {
		const db = emptyDb();
		const all = migrations(), at = all.findIndex((m) => m.name.endsWith('_events.sql'));
		assert.ok(at > 0);
		// The code that makes the earlier rows here is today's, which reads a topic's space and section: so the spaces
		// migration goes in first (it stands without events until someone is invited) with the sections one, and the
		// events migration over the rows after.
		const spaces = all.findIndex((m) => m.name.endsWith('_spaces.sql')), sections = all.findIndex((m) => m.name.endsWith('_forum_sections.sql'));
		assert.ok(spaces > at && sections > at);
		for (const m of [...all.slice(0, at), all[spaces], all[sections]]) await db.exec(m.sql);
		await load(db, [QP, NT, APP]);
		await db.query("UPDATE open_index.records SET added_at = '2026-11-01'::timestamptz + (CASE id WHEN $1 THEN 1 WHEN $2 THEN 2 ELSE 3 END) * interval '1 day'", [QP.id, NT.id]);
		// Post ids with gaps, as a live table has them.
		await db.query("SELECT setval(pg_get_serial_sequence('open_index.comments', 'id'), 40)");
		const first = await comment(db, QP.id, ada, { body: 'A first comment.' }, yes);
		const topic = await startTopic(db, ada, { title: 'A question from before', body: 'Asked before the log began.' }, yes);
		await db.query("SELECT setval(pg_get_serial_sequence('open_index.comments', 'id'), 90)");
		const answer = await post(db, { topic: topic.id }, bob, { body: 'An answer from before.' }, yes);
		assert.deepEqual([first.id, topic.question.id, answer.id].map(Number), [41, 42, 91]);

		for (const m of all.slice(at).filter((m) => m !== all[spaces] && m !== all[sections])) await db.exec(m.sql);
		assert.deepEqual(await events(db), [
			{ seq: -3, kind: 'record', path: QP.id, voter: '' }, { seq: -2, kind: 'record', path: NT.id, voter: '' }, { seq: -1, kind: 'record', path: APP.id, voter: '' },
			{ seq: 41, kind: 'comment', path: `${QP.id}/41`, voter: 'Ada' }, { seq: 42, kind: 'question', path: `forum/${topic.id}/42`, voter: 'Ada' },
			{ seq: 91, kind: 'answer', path: `forum/${topic.id}/91`, voter: 'bob' },
		]);
		// A since a client held (a post id) means what it meant: the posts after it. Zero is every post, and no old record.
		assert.deepEqual((await log(db, null, {}, { since: 41 })).entries.map((e) => e.seq), [42, 91]);
		assert.deepEqual((await log(db, null, {}, { since: 0 })).entries.map((e) => e.seq), [41, 42, 91]);
		// Newest first, the listing ends in the records that were there, the latest added first.
		const newest = await log(db, null);
		assert.deepEqual(newest.entries.map((e) => e.seq), [91, 42, 41, -1, -2, -3]);
		assert.equal(newest.since, 91);
		assert.deepEqual((await log(db, null, {}, { q: 'kind:record' })).since, 0, 'only old records: nothing to move a cursor past');
		// What comes next continues after the largest seq, records and posts in one order, and a reload still adds nothing.
		const late = item('arxiv/2611.00003');
		await load(db, [QP, NT, APP, late]);
		const reply = await comment(db, QP.id, bob, { body: 'A reply after the migration.', parent: first.id }, yes);
		assert.equal(Number(reply.id), 92);
		assert.deepEqual((await log(db, null, {}, { since: 91 })).entries.map((e) => [e.seq, e.kind, e.path]), [[92, 'record', late.id], [93, 'comment', `${QP.id}/92`]]);
		await load(db, [QP, NT, APP, late]);
		assert.equal((await events(db)).length, 8);
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
		const topic = await startTopic(db, ada, { title: 'Is grokking a phase transition?', body: `Compare ${QP.id} on entanglement.` }, yes);
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

	test('kind: is what happened', async () => {
		assert.deepEqual(await found('kind:record'), ['qp', 'nt', 'app']);
		assert.deepEqual(await found('kind:question'), ['question', 'elsewhere']);
		assert.deepEqual(await found('kind:answer'), ['answer']);
		assert.deepEqual(await found('kind:comment'), ['onQp', 'reply', 'remark', 'own']);
		assert.deepEqual(await found('kind:REVIEW'), ['review']);
		assert.deepEqual(await found('NOT kind:record'), ['onQp', 'reply', 'review', 'question', 'answer', 'remark', 'own', 'elsewhere']);
		await assert.rejects(found('kind:paper'), /unknown kind:paper/);
	});

	test('re: is the posts on a record or naming it, not the record itself', async () => {
		assert.deepEqual(await found(`re:${QP.id}`), ['onQp', 'reply', 'question']);
		assert.deepEqual(await found(`re:${NT.id}`), ['review']);
		assert.deepEqual(await found(`re:${APP.id}`), ['review']);
		assert.deepEqual(await found('re:app/none'), []);
		await assert.rejects(found('re:'), /re: needs a record id/);
		// The records a post names are on its line.
		assert.deepEqual((await log(db, null, {}, { q: `re:${NT.id}` })).entries[0].mentions, [NT.id]);
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

	test('by: is a person\'s posts', async () => {
		assert.deepEqual(await found('by:@bob'), ['reply', 'review', 'answer']);
		assert.deepEqual(await found('by:@BOB kind:review'), ['review']);
		assert.deepEqual(await found('by:@ada OR by:@eve'), ['onQp', 'question', 'remark', 'own', 'elsewhere']);
		assert.deepEqual(await found('by:@nobody'), []);
	});

	test('@me is the caller, and needs one', async () => {
		assert.deepEqual(await found('to:@me', { reader: { login: 'Ada' } }), ['reply', 'answer', 'remark']);
		assert.deepEqual(await found('by:@me', { reader: { login: 'bob' } }), ['reply', 'review', 'answer']);
		for (const q of ['to:@me', 'by:@me', 'kind:answer OR to:me']) {
			await assert.rejects(found(q), (e) => e instanceof NeedsReader && e.status === 401 && e.code === 'sign_in', q);
			await assert.rejects(found(q, { reader: null }), NeedsReader, q);
		}
	});

	test('a record term matches a new record that fits, and a post through the record it is on or names', async () => {
		// quant-ph: the record, the two posts on it, and the forum question that names it.
		assert.deepEqual(await found('cat:quant-ph'), ['qp', 'onQp', 'reply', 'question']);
		// math.NT: the record, and the review on another record that names it.
		assert.deepEqual(await found('cat:math.NT'), ['nt', 'review']);
		// math: both math records; the review is on one and names the other.
		assert.deepEqual(await found('cat:math'), ['nt', 'app', 'review']);
		assert.deepEqual(await found('source:app'), ['app', 'review']);
		assert.deepEqual(await found('source:arxiv NOT kind:record'), ['onQp', 'reply', 'review', 'question']);
		assert.deepEqual(await found('is:formalized'), ['nt', 'review']);
		assert.deepEqual(await found(`id:${QP.id}`), ['qp', 'onQp', 'reply', 'question']);
		assert.deepEqual(await found('ti:entanglement'), ['qp', 'onQp', 'reply', 'question']);
		assert.deepEqual(await found('published:2026-11'), ['qp', 'nt', 'app', 'onQp', 'reply', 'review', 'question']);
		assert.deepEqual(await found('published:2025'), []);
		// Not: a post no record of which fits, forum posts that name none included.
		assert.deepEqual(await found('NOT cat:math kind:comment'), ['onQp', 'reply', 'remark', 'own']);
		assert.deepEqual(await found('cat:quant-ph kind:record OR cat:math.NT kind:review'), ['qp', 'review']);
		await assert.rejects(found('foo:bar'), (e: { message: string; fix: string }) => e.message === 'unknown field foo:' && /abs:.*kind:.*re:.*to:/.test(e.fix));
	});

	test('a bare word is looked for in the record, and in a post\'s own text and its topic\'s title', async () => {
		// "entanglement": the record's title (so the posts on it) and the question's own text.
		assert.deepEqual(await found('entanglement'), ['qp', 'onQp', 'reply', 'question']);
		// "grokking": a topic's title, so every post in it.
		assert.deepEqual(await found('grokking'), ['question', 'answer', 'remark', 'own']);
		assert.deepEqual(await found('"mean-field limit"'), ['remark']);
		assert.deepEqual(await found('critical*'), ['reply']);
		assert.deepEqual(await found('grokking by:@eve'), ['remark']);
	});

	test('a path and a query narrow together; since and limit page what is left', async () => {
		assert.deepEqual(await found('by:@bob', {}, { forum: true }), ['answer']);
		assert.deepEqual(await found('by:@bob', {}, { record: QP.id }), ['reply']);
		assert.deepEqual(await found('kind:record', {}, { source: 'arxiv' }), ['qp', 'nt']);
		assert.deepEqual(await found('kind:record', {}, { record: QP.id }), [], 'a record\'s own log is its thread');
		const first = await log(db, null, {}, { since: 0, q: 'NOT kind:record', limit: 3 });
		assert.deepEqual(first.entries.map((e) => e.path), [paths.onQp, paths.reply, paths.review]);
		const next = await log(db, null, {}, { since: first.since, q: 'NOT kind:record', limit: 3 });
		assert.deepEqual(next.entries.map((e) => e.path), [paths.question, paths.answer, paths.remark]);
		assert.equal((await log(db, null, {}, { since: 1000, q: 'kind:record' })).since, 1000);
	});
});
