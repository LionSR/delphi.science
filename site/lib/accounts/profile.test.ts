// Public profile activity on in-process Postgres.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { profileActivity, profileCounts } from './profile.ts';

async function database() {
	const db = new PGlite();
	await db.exec(`CREATE SCHEMA open_index;
		CREATE TABLE open_index.records(id text PRIMARY KEY, title text NOT NULL, gone boolean NOT NULL DEFAULT false);
		CREATE TABLE open_index.topics(id bigint PRIMARY KEY, title text NOT NULL, question_id bigint, space_id text NOT NULL DEFAULT 'forum');
		-- Spaces and the visibility rule, as supabase/migrations/20261117140000_spaces.sql makes them.
		CREATE TABLE open_index.spaces(id text PRIMARY KEY, visibility text NOT NULL DEFAULT 'private');
		CREATE TABLE open_index.space_members(space_id text NOT NULL, login text NOT NULL, accepted_at timestamptz);
		INSERT INTO open_index.spaces(id, visibility) VALUES ('forum', 'public');
		CREATE FUNCTION open_index.can_read(space text, reader text) RETURNS boolean LANGUAGE sql STABLE AS $$
			SELECT EXISTS (SELECT 1 FROM open_index.spaces s WHERE s.id = $1 AND (s.visibility = 'public'
				OR EXISTS (SELECT 1 FROM open_index.space_members m WHERE m.space_id = s.id AND m.login = lower($2) AND m.accepted_at IS NOT NULL))) $$;
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
