// Session and agent keys and the names shown for them, on in-process Postgres with the real migrations.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { QueryError } from '#lib/errors.ts';
import { migratedDb } from '#lib/testing.ts';
import { agentName, createAgentKey, createSession, personFromSession, profileName, revokeKey, voterFromKey } from './keys.ts';
import { sha256 } from '#lib/hash.ts';

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

test('a login belongs to the first GitHub account that signs in with it', async () => {
	const { bindGitHubAccount } = await import('./identity.ts');
	assert.equal(await bindGitHubAccount(db, 'Renamer', 1001), true);
	assert.equal(await bindGitHubAccount(db, 'renamer', 1001), true, 'the same account again, whatever the case');
	// The person renames their account; someone else registers the freed login.
	assert.equal(await bindGitHubAccount(db, 'renamer', 2002), false, 'a different account cannot take the login over');
	for (const id of [undefined, null, '1001', 0, -1, 1.5]) assert.equal(await bindGitHubAccount(db, 'renamer', id), false);

	const session = await createSession(db, 'Renamer'), agent = await createAgentKey(db, 'Renamer', 'Codex');
	assert.equal(await bindGitHubAccount(db, 'renamed', 1001), true, 'the renamed account signs in under its new login');
	assert.equal(await voterFromKey(db, session), null, 'and its sessions under the old login end');
	assert.equal(await voterFromKey(db, agent), null, 'with its agent keys');
	assert.equal(await bindGitHubAccount(db, 'renamer', 2002), false, 'the old login stays theirs');
});

test('signing out everywhere ends every session and leaves agent keys', async () => {
	const { revokeSessions } = await import('./keys.ts');
	const [a, b, other, agent] = [await createSession(db, 'roamer'), await createSession(db, 'roamer'), await createSession(db, 'bystander'), await createAgentKey(db, 'roamer', 'Codex')];
	assert.equal(await revokeSessions(db, 'roamer'), 2);
	assert.deepEqual([await voterFromKey(db, a), await voterFromKey(db, b)], [null, null]);
	assert.ok(await voterFromKey(db, other));
	assert.ok(await voterFromKey(db, agent));
});

test('a session lasts as long as it was given', async () => {
	const week = await createSession(db, 'reviewer_demo', 'Plugin reviewer', 7);
	const { days } = (await db.query<{ days: number }>(`SELECT round(extract(epoch FROM expires_at - now()) / 86400)::int AS days FROM open_index.agent_keys WHERE key_hash = $1`, [sha256(week)])).rows[0];
	assert.equal(days, 7);
});

test('sign-in attempts are limited by caller', async () => {
	const { attempt, origin } = await import('./attempts.ts');
	const from = (ip: string) => origin(new Headers({ 'x-forwarded-for': `${ip}, 10.0.0.1` }));
	assert.notEqual(from('203.0.113.7'), from('203.0.113.8'));
	for (let i = 0; i < 3; i++) await attempt(db, 'review', from('203.0.113.7'), 3, 15);
	await assert.rejects(attempt(db, 'review', from('203.0.113.7'), 3, 15), (e: { status?: number; code?: string }) => e.status === 429 && e.code === 'rate_limited');
	await attempt(db, 'review', from('203.0.113.8'), 3, 15); // another caller is not held back
	await attempt(db, 'device', from('203.0.113.7'), 3, 15); // nor another kind of attempt
});
