// Session keys and display names on in-process Postgres.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createAgentKey, createSession, personFromSession, profileName, revokeKey, sha256, voterFromKey } from './keys.ts';

async function database(named: boolean) {
	const db = new PGlite();
	await db.exec(`CREATE SCHEMA open_index; CREATE TABLE open_index.agent_keys (
		key_hash text PRIMARY KEY, login text NOT NULL, agent text NOT NULL DEFAULT '',
		revoked_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days'
		${named ? ", name text NOT NULL DEFAULT ''" : ''});`);
	return db;
}

test('display-name normalization is optional, whitespace-neutral and Unicode bounded', () => {
	for (const name of [undefined, null, 0, {}, '', ' \n\t ']) assert.equal(profileName(name), '');
	assert.equal(profileName('  Alice \n Research  '), 'Alice Research');
	assert.equal(profileName('e\u0301'), 'é');
	const bounded = profileName('学🧮'.repeat(80));
	assert.equal([...bounded].length, 100); assert.equal(bounded, '学🧮'.repeat(50));
});

test('existing schema without name supports sign-in and login fallback without alteration', async () => {
	const db = await database(false);
	try {
		const key = await createSession(db, 'ada', 'Ada Research');
		assert.deepEqual(await personFromSession(db, key), { login: 'ada', agent: '', name: 'ada' });
		assert.equal((await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema='open_index' AND table_name='agent_keys' AND column_name='name'")).rows.length, 0);
	} finally { await db.close(); }
});

test('named sessions retain cosmetic names while API identity stays the verified login', async () => {
	const db = await database(true);
	try {
		const key = await createSession(db, 'ada', '  Alice & Bob  ');
		assert.deepEqual(await personFromSession(db, key), { login: 'ada', agent: '', name: 'Alice & Bob' });
		assert.deepEqual(await voterFromKey(db, key), { login: 'ada', agent: '' });
		const long = await createSession(db, 'unicode-author', '学🧮'.repeat(80));
		assert.equal((await personFromSession(db, long))?.name, '学🧮'.repeat(50));
	} finally { await db.close(); }
});

test('missing and whitespace-only profile names fall back to login, including legacy values', async () => {
	const db = await database(true);
	try {
		for (const name of [undefined, '', ' \n\t ']) {
			const key = await createSession(db, 'ada', name);
			assert.equal((await personFromSession(db, key))?.name, 'ada');
			await db.query("UPDATE open_index.agent_keys SET name=$2 WHERE key_hash=$1", [await sha256(key), ' \n\t ']);
			assert.equal((await personFromSession(db, key))?.name, 'ada');
		}
	} finally { await db.close(); }
});

test('agent keys remain API callers and cannot become browser people or device approvers', async () => {
	const db = await database(true);
	try {
		const key = await createAgentKey(db, 'ada', 'Offline Agent');
		assert.deepEqual(await voterFromKey(db, key), { login: 'ada', agent: 'Offline Agent' });
		assert.equal(await personFromSession(db, key), null);
		assert.equal((await db.query<{ name: string }>('SELECT name FROM open_index.agent_keys')).rows[0].name, '');
	} finally { await db.close(); }
});

test('revoked, expired and unknown sessions do not identify a person', async () => {
	const db = await database(true);
	try {
		const revoked = await createSession(db, 'ada', 'Ada Research');
		await revokeKey(db, 'ada', { key: revoked });
		assert.equal(await personFromSession(db, revoked), null);
		const expired = await createSession(db, 'ada', 'Ada Research');
		await db.query("UPDATE open_index.agent_keys SET expires_at=now()-interval '1 second' WHERE key_hash=$1", [await sha256(expired)]);
		assert.equal(await personFromSession(db, expired), null);
		assert.equal(await personFromSession(db, 'unknown-offline-fixture'), null);
	} finally { await db.close(); }
});
