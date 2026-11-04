// Public profile activity on in-process Postgres.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { profileActivity, profileCounts, profileVotes, normalizeProfileLogin } from './profile.ts';
import { QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';

async function database() {
	const db = new PGlite();
	await db.exec(`CREATE SCHEMA open_index;
		CREATE TABLE open_index.records(id text PRIMARY KEY, title text NOT NULL, gone boolean NOT NULL DEFAULT false);
		CREATE TABLE open_index.topics(id bigint PRIMARY KEY, title text NOT NULL, question_id bigint);
		CREATE TABLE open_index.votes(record_id text NOT NULL, voter text NOT NULL, agent text NOT NULL DEFAULT '', value smallint, emoji text, note text, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (record_id, voter));
		CREATE TABLE open_index.comments(id bigint PRIMARY KEY, record_id text, topic_id bigint, parent_id bigint, voter text NOT NULL,
			agent text NOT NULL DEFAULT '', body text NOT NULL, review boolean NOT NULL DEFAULT false, at timestamptz NOT NULL DEFAULT now());
		INSERT INTO open_index.records(id, title, gone) VALUES ('app/boundary', 'Finite-chain boundary terms', false), ('app/gone', 'An unavailable record', true);
		INSERT INTO open_index.topics(id, title) VALUES (10, 'Which boundary convention is assumed?');`);
	return db;
}

type Place = { record?: string; topic?: number; parent?: number; review?: boolean };

async function post(db: PGlite, id: number, voter = 'ada', agent = '', place: Place = { record: 'app/boundary' }) {
	await db.query('INSERT INTO open_index.comments(id, voter, agent, body, record_id, topic_id, parent_id, review) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
		[id, voter, agent, 'The endpoint terms remain for an open chain.', place.record ?? null, place.topic ?? null, place.parent ?? null, place.review ?? false]);
}

async function withDb(run: (db: PGlite) => Promise<void>) {
	const db = await database();
	try {
		await run(db);
	} finally {
		await db.close();
	}
}

test('login validation normalizes case without accepting arbitrary account paths', () => {
	assert.equal(normalizeProfileLogin('Ada-Lovelace'), 'ada-lovelace');
	for (const input of ['', null, '-ada', 'a'.repeat(40), 'ada/research']) {
		assert.throws(() => normalizeProfileLogin(input), QueryError);
	}
});

test('human and bot contributions come only from public rows with an explicit DTO whitelist', () => withDb(async (db) => {
	await post(db, 1, 'Ada');
	await post(db, 2, 'ADA', 'Boundary Bot', { topic: 10, review: true });
	await post(db, 3, 'bo', 'Other Bot');
	const page = await profileActivity(db, 'aDa');
	assert.equal(page.login, 'ada');
	assert.deepEqual(page.posts.map((p) => p.id), [2, 1]);
	assert.equal(page.posts[0].agent, 'Boundary Bot');
	assert.equal(page.posts[1].agent, '');
	assert.equal(page.posts[0].permalink, '/forum/10#p2');
	assert.equal(page.posts[1].permalink, '/r/app/boundary#p1');
	assert.deepEqual(Object.keys(page.posts[0]).sort(), ['agent', 'at', 'body', 'id', 'kind', 'permalink', 'title', 'topic_id', 'voter']);
	assert.equal(page.next_cursor, null);
}));

test('descending keyset pagination has no duplicates and ignores later new inserts', () => withDb(async (db) => {
	for (let id = 1; id <= 45; id++) await post(db, id);
	const first = await profileActivity(db, 'ada');
	assert.equal(first.posts.length, 20);
	assert.equal(first.posts[0].id, 45);
	await post(db, 46);
	const second = await profileActivity(db, 'ADA', { cursor: first.next_cursor! });
	const third = await profileActivity(db, 'ada', { cursor: second.next_cursor! });
	const ids = [...first.posts, ...second.posts, ...third.posts].map((p) => p.id);
	assert.equal(ids.length, 45);
	assert.equal(new Set(ids).size, 45);
	assert.ok(!ids.includes(46));
	assert.equal(third.next_cursor, null);
}));

test('limits and malformed or cross-owner cursors fail before a query', () => withDb(async (db) => {
	await post(db, 1);
	await post(db, 2);
	const page = await profileActivity(db, 'ada', { limit: 1 });
	assert.ok(page.next_cursor);
	let calls = 0;
	const noQuery: Db = { query: async () => { calls++; throw new Error('query must not run'); } };
	for (const limit of [0, 51, 1.5, NaN]) await assert.rejects(profileActivity(noQuery, 'ada', { limit }), QueryError);
	const zero = Buffer.from(JSON.stringify({ v: 1, login: 'ada', before: 0 })).toString('base64url');
	for (const cursor of ['?', 'x'.repeat(300), zero]) await assert.rejects(profileActivity(noQuery, 'ada', { cursor }), QueryError);
	await assert.rejects(profileActivity(noQuery, 'bo', { cursor: page.next_cursor! }), QueryError);
	assert.equal(calls, 0);
}));

test('nonexistent and private-only handles have identical empty public activity without private-table dependence', () => withDb(async (db) => {
	const missing = await profileActivity(db, 'quiet-owner');
	await db.exec(`CREATE TABLE open_index.agent_keys(login text, agent text, key_hash text);
		CREATE TABLE open_index.moderations(voter text, reason text);
		INSERT INTO open_index.agent_keys VALUES ('quiet-owner', 'Unused research bot', 'offline-placeholder');
		INSERT INTO open_index.moderations VALUES ('quiet-owner', 'An unpublished draft note');`);
	const privateOnly = await profileActivity(db, 'quiet-owner');
	assert.deepEqual(privateOnly, missing);
	assert.deepEqual(privateOnly, { login: 'quiet-owner', posts: [], next_cursor: null });
}));

test('posts on missing or gone places, in topics without a root post, or replying across places do not expose activity', () => withDb(async (db) => {
	await post(db, 1, 'ada', '', { record: 'app/missing' });
	await post(db, 2, 'ada', '', { record: 'app/gone' });
	await post(db, 3, 'ada', '', { topic: 999 });
	await post(db, 4, 'ada', '', { record: 'app/boundary', parent: 999 });
	await post(db, 7, 'bo', '', { topic: 10 });
	await post(db, 5, 'ada', '', { record: 'app/boundary', parent: 7 });
	await db.query("INSERT INTO open_index.comments(id, record_id, topic_id, voter, body) VALUES (6, 'app/boundary', 10, 'ada', 'A boundary-condition clarification.')");
	await post(db, 8);
	await post(db, 9, 'ada', '', { topic: 10, parent: 7 });
	// A topic holding only a reply cycle, with no root post.
	await db.exec("INSERT INTO open_index.topics(id, title) VALUES (20, 'An incomplete boundary question')");
	await post(db, 11, 'ada', '', { topic: 20, parent: 12 });
	await post(db, 12, 'ada', 'Boundary Bot', { topic: 20, parent: 11 });
	const page = await profileActivity(db, 'ada');
	assert.deepEqual(page.posts.map((p) => p.id), [9, 8]);
	assert.equal(page.posts[0].parent, 7);
	assert.equal(page.posts[0].title, 'Which boundary convention is assumed?');
}));

test('permalinks encode public record identifiers instead of interpreting their punctuation', () => withDb(async (db) => {
	const id = 'app/boundary notes?version=1#terms';
	await db.query('INSERT INTO open_index.records(id, title) VALUES ($1, $2)', [id, 'Boundary notes']);
	await post(db, 1, 'ada', '', { record: id });
	assert.equal((await profileActivity(db, 'ada')).posts[0].permalink, '/r/app/boundary%20notes%3Fversion%3D1%23terms#p1');
}));

test('query failures expose a neutral public error without database diagnostics', async () => {
	const db: Db = { query: async () => { throw new Error('offline internal database diagnostic'); } };
	await assert.rejects(profileActivity(db, 'ada'), (e) => e instanceof QueryError && !e.message.includes('diagnostic') && !e.fix.includes('diagnostic'));
});

test('posts are typed as topic, reply, comment or review, and tabs and counts follow the types', () => withDb(async (db) => {
	await post(db, 1, 'ada', '', { topic: 10 });
	await db.exec('UPDATE open_index.topics SET question_id = 1 WHERE id = 10');
	await post(db, 2, 'ada', '', { topic: 10 });
	await post(db, 3, 'ada', '', { topic: 10, parent: 2 });
	await post(db, 4, 'ada', '', { record: 'app/boundary', review: true });
	await post(db, 5, 'ada');
	await post(db, 6, 'bo', '', { topic: 10 });
	const kinds = (await profileActivity(db, 'ada')).posts.map((p) => [p.id, p.kind]);
	assert.deepEqual(kinds, [[5, 'comment'], [4, 'review'], [3, 'comment'], [2, 'answer'], [1, 'question']]);
	assert.deepEqual((await profileActivity(db, 'ada', { tab: 'topics' })).posts.map((p) => p.id), [1]);
	assert.deepEqual((await profileActivity(db, 'ada', { tab: 'replies' })).posts.map((p) => p.id), [2]);
	assert.deepEqual((await profileActivity(db, 'ada', { tab: 'comments' })).posts.map((p) => p.id), [5, 4, 3]);
	await db.exec(`INSERT INTO open_index.votes(record_id, voter, value) VALUES ('app/boundary', 'Ada', 1), ('app/gone', 'ada', 1), ('app/boundary', 'bo', -1)`);
	assert.deepEqual(await profileCounts(db, 'ADA'), { topics: 1, replies: 1, comments: 3, votes: 1 });
}));

test('record votes page newest first with a cursor that keeps full timestamp precision', () => withDb(async (db) => {
	for (let i = 1; i <= 5; i++) await db.query('INSERT INTO open_index.records(id, title) VALUES ($1, $2)', [`app/r${i}`, `Record ${i}`]);
	// Microseconds apart, so a millisecond cursor would skip some.
	for (let i = 1; i <= 5; i++) await db.query(`INSERT INTO open_index.votes(record_id, voter, agent, value, note, at)
		VALUES ($1, 'ada', 'Daily picks', 1, 'Matches open-chain work.', '2026-11-03 07:00:00.000001+00'::timestamptz + make_interval(secs => $2 * 0.000001))`, [`app/r${i}`, i]);
	await db.query("INSERT INTO open_index.votes(record_id, voter, value) VALUES ('app/gone', 'ada', 1)");
	const first = await profileVotes(db, 'ada', { limit: 2 });
	assert.deepEqual(first.votes.map((v) => v.record_id), ['app/r5', 'app/r4']);
	assert.equal(first.votes[0].permalink, '/r/app/r5');
	assert.deepEqual(Object.keys(first.votes[0]).sort(), ['agent', 'at', 'emoji', 'note', 'permalink', 'record_id', 'title', 'value']);
	const second = await profileVotes(db, 'ada', { limit: 2, cursor: first.next_cursor! });
	const third = await profileVotes(db, 'ada', { limit: 2, cursor: second.next_cursor! });
	assert.deepEqual([...second.votes, ...third.votes].map((v) => v.record_id), ['app/r3', 'app/r2', 'app/r1']);
	assert.equal(third.next_cursor, null);
	await assert.rejects(profileVotes(db, 'bo', { cursor: first.next_cursor! }), QueryError);
	await assert.rejects(profileVotes(db, 'ada', { cursor: 'not-a-cursor' }), QueryError);
}));
