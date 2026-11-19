// Session and agent keys and the names shown for them, on in-process Postgres with the real migrations.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { migratedDb } from '#lib/testing.ts';
import { createAgentKey, createSession, personFromSession, revokeKey, voterFromKey } from './keys.ts';
import { sha256 } from '#lib/hash.ts';

let db: PGlite;
before(async () => { db = await migratedDb(); });
after(() => db.close());

test('agent keys remain API callers and cannot become browser people or device approvers', async () => {
	const key = await createAgentKey(db, 'ada', 'Offline Agent');
	assert.deepEqual(await voterFromKey(db, key), { login: 'ada', agent: 'Offline Agent' });
	assert.equal(await personFromSession(db, key), null);
	assert.equal((await db.query<{ name: string }>('SELECT name FROM open_index.agent_keys WHERE key_hash = $1', [await sha256(key)])).rows[0].name, '');
});

test('revoked, expired and unknown sessions do not identify a person', async () => {
	const revoked = await createSession(db, 'ada', 'Ada Research');
	await revokeKey(db, 'ada', { key: revoked });
	assert.equal(await personFromSession(db, revoked), null);
	const expired = await createSession(db, 'ada', 'Ada Research');
	await db.query("UPDATE open_index.agent_keys SET expires_at = now() - interval '1 second' WHERE key_hash = $1", [await sha256(expired)]);
	assert.equal(await personFromSession(db, expired), null);
	assert.equal(await personFromSession(db, 'unknown-offline-fixture'), null);
});
