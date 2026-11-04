// Session and agent keys and the names shown for them, on in-process Postgres with the real migrations.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { QueryError } from '../errors.ts';
import { migratedDb } from '../testing.ts';
import { agentName, createAgentKey, createSession, personFromSession, profileName, revokeKey, voterFromKey } from './keys.ts';
import { sha256 } from '../hash.ts';

let db: PGlite;
before(async () => { db = await migratedDb(); });
after(() => db.close());

test('display-name normalization is optional, whitespace-neutral and Unicode bounded', () => {
	for (const name of [undefined, null, 0, {}, '', ' \n\t ']) assert.equal(profileName(name), '');
	assert.equal(profileName('  Alice \n Research  '), 'Alice Research');
	assert.equal(profileName('e\u0301'), 'é');
	const bounded = profileName('学🧮'.repeat(80));
	assert.equal([...bounded].length, 100); assert.equal(bounded, '学🧮'.repeat(50));
});

test('agent names are trimmed and at most 60 characters; missing, blank, non-text or longer ones are refused with a fix', () => {
	assert.equal(agentName('  Claude Code '), 'Claude Code');
	assert.equal(agentName('🧮'.repeat(60)), '🧮'.repeat(60)); // counted in code points
	for (const [agent, fix] of [[undefined, /your name/], [' \n ', /your name/], [7, /your name/], ['a'.repeat(61), /at most 60/]] as const)
		assert.throws(() => agentName(agent), (e: unknown) => e instanceof QueryError && fix.test(e.fix), String(agent));
});

test('sessions keep a cosmetic name, or the login when it is blank, while the API identity stays the login', async () => {
	for (const [name, shown] of [['  Alice & Bob  ', 'Alice & Bob'], [undefined, 'ada'], ['', 'ada'], [' \n\t ', 'ada']]) {
		const key = await createSession(db, 'ada', name);
		assert.deepEqual(await personFromSession(db, key), { login: 'ada', agent: '', name: shown }, String(name));
		assert.deepEqual(await voterFromKey(db, key), { login: 'ada', agent: '' });
	}
	// A blank name stored before names were cleaned on the way in.
	const legacy = await createSession(db, 'ada');
	await db.query('UPDATE open_index.agent_keys SET name = $2 WHERE key_hash = $1', [await sha256(legacy), ' \n\t ']);
	assert.equal((await personFromSession(db, legacy))?.name, 'ada');
});

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
