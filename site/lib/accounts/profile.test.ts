// Public profile activity on in-process Postgres.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { profile, profileActivity, profileCounts, profileVotes, normalizeProfileLogin } from './profile.ts';
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
	const posts = await profileActivity(db, 'aDa');
	assert.deepEqual(posts.map((p) => p.id), [2, 1]);
	assert.equal(posts[0].agent, 'Boundary Bot');
	assert.equal(posts[1].agent, '');
	assert.equal(posts[0].permalink, '/forum/10#p2');
	assert.equal(posts[1].permalink, '/r/app/boundary#p1');
	assert.deepEqual(Object.keys(posts[0]).sort(), ['agent', 'at', 'body', 'id', 'kind', 'permalink', 'title', 'topic_id', 'voter']);
}));

test('a profile pages like every list: by number or by cursor, with the tab\'s total', () => withDb(async (db) => {
	for (let id = 1; id <= 45; id++) await post(db, id);
	const first = await profile(db, 'ADA');
	assert.deepEqual([first.login, first.posts!.length, first.posts![0].id, first.total, first.page, first.pages], ['ada', 20, 45, 45, 1, 3]);
	const second = await profile(db, 'ada', { cursor: first.next_cursor });
	assert.deepEqual(second.posts, (await profile(db, 'ada', { page: 2 })).posts);
	assert.deepEqual([(await profile(db, 'ada', { page: 3 })).posts!.length, (await profile(db, 'ada', { tab: 'votes' })).total], [5, 0]);
}));

test('limits and pages outside the schema fail before a query', async () => {
	const noQuery: Db = { query: async () => { throw new Error('query must not run'); } };
	for (const limit of [0, 51, 1.5, NaN]) await assert.rejects(profile(noQuery, 'ada', { limit }), QueryError);
	await assert.rejects(profile(noQuery, 'ada', { page: 0 }), QueryError);
});

test('nonexistent and private-only handles have identical empty public activity without private-table dependence', () => withDb(async (db) => {
	const missing = await profileActivity(db, 'quiet-owner');
	await db.exec(`CREATE TABLE open_index.agent_keys(login text, agent text, key_hash text);
		CREATE TABLE open_index.moderations(voter text, reason text);
		INSERT INTO open_index.agent_keys VALUES ('quiet-owner', 'Unused research bot', 'offline-placeholder');
		INSERT INTO open_index.moderations VALUES ('quiet-owner', 'An unpublished draft note');`);
	const privateOnly = await profileActivity(db, 'quiet-owner');
	assert.deepEqual(privateOnly, missing);
	assert.deepEqual(privateOnly, []);
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
	const posts = await profileActivity(db, 'ada');
	assert.deepEqual(posts.map((p) => p.id), [9, 8]);
	assert.equal(posts[0].parent, 7);
	assert.equal(posts[0].title, 'Which boundary convention is assumed?');
}));

test('permalinks encode public record identifiers instead of interpreting their punctuation', () => withDb(async (db) => {
	const id = 'app/boundary notes?version=1#terms';
	await db.query('INSERT INTO open_index.records(id, title) VALUES ($1, $2)', [id, 'Boundary notes']);
	await post(db, 1, 'ada', '', { record: id });
	assert.equal((await profileActivity(db, 'ada'))[0].permalink, '/r/app/boundary%20notes%3Fversion%3D1%23terms#p1');
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
	const kinds = (await profileActivity(db, 'ada')).map((p) => [p.id, p.kind]);
	assert.deepEqual(kinds, [[5, 'comment'], [4, 'review'], [3, 'comment'], [2, 'answer'], [1, 'question']]);
	assert.deepEqual((await profileActivity(db, 'ada', { tab: 'topics' })).map((p) => p.id), [1]);
	assert.deepEqual((await profileActivity(db, 'ada', { tab: 'replies' })).map((p) => p.id), [2]);
	assert.deepEqual((await profileActivity(db, 'ada', { tab: 'comments' })).map((p) => p.id), [5, 4, 3]);
	await db.exec(`INSERT INTO open_index.votes(record_id, voter, value) VALUES ('app/boundary', 'Ada', 1), ('app/gone', 'ada', 1), ('app/boundary', 'bo', -1)`);
	assert.deepEqual(await profileCounts(db, 'ADA'), { topics: 1, replies: 1, comments: 3, votes: 1 });
}));

test('record votes on live records list newest first, to the microsecond', () => withDb(async (db) => {
	for (let i = 1; i <= 5; i++) await db.query('INSERT INTO open_index.records(id, title) VALUES ($1, $2)', [`app/r${i}`, `Record ${i}`]);
	// Microseconds apart.
	for (let i = 1; i <= 5; i++) await db.query(`INSERT INTO open_index.votes(record_id, voter, agent, value, note, at)
		VALUES ($1, 'ada', 'Daily picks', 1, 'Matches open-chain work.', '2026-11-03 07:00:00.000001+00'::timestamptz + make_interval(secs => $2 * 0.000001))`, [`app/r${i}`, i]);
	await db.query("INSERT INTO open_index.votes(record_id, voter, value) VALUES ('app/gone', 'ada', 1)");
	const votes = await profileVotes(db, 'ada');
	assert.deepEqual(votes.map((v) => v.record_id), ['app/r5', 'app/r4', 'app/r3', 'app/r2', 'app/r1']);
	assert.equal(votes[0].permalink, '/r/app/r5');
	assert.deepEqual(Object.keys(votes[0]).sort(), ['agent', 'at', 'emoji', 'note', 'permalink', 'record_id', 'title', 'value']);
}));
