// Public names and affiliations on in-process Postgres, with the real migrations.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { editPublicName, profileAffiliation, publicName, publicNames, rememberGitHubProfile } from './people.ts';

const migration = (f: string) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');

async function database() {
	const db = new PGlite();
	await db.exec(`CREATE SCHEMA open_index; CREATE TABLE open_index.agent_keys (key_hash text PRIMARY KEY, login text NOT NULL,
		agent text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, name text NOT NULL DEFAULT '');
		INSERT INTO open_index.agent_keys (key_hash, login, agent, name, created_at) VALUES
		('a', 'Ada', '', 'Old Name', now() - interval '1 day'), ('b', 'Ada', '', 'Ada Lovelace', now()),
		('c', 'bob', 'Claude Code', 'Agent Name', now()), ('d', 'cy', '', 'cy', now());`);
	await db.exec(migration('20261103000200_people.sql'));
	return db;
}

test('affiliations drop GitHub\'s leading @ only before a name', () => {
	assert.equal(profileAffiliation('  @anthropic '), 'anthropic');
	assert.equal(profileAffiliation('@'), '@');
	assert.equal(profileAffiliation(null), '');
});

test('the migration starts from the newest named sign-in; lookups ignore login case and drop bare logins', async () => {
	const db = await database();
	try {
		assert.deepEqual(Object.fromEntries(await publicNames(db, ['ADA', 'ada', 'bob', 'cy'])),
			{ ADA: { name: 'Ada Lovelace', affiliation: '' }, ada: { name: 'Ada Lovelace', affiliation: '' } });
		assert.equal((await publicNames(db, [])).size, 0);
		assert.deepEqual(await publicName(db, 'nobody'), { name: '', affiliation: '' });
	} finally { await db.close(); }
});

test('sign-in copies GitHub until the person edits; their edits, even blank ones, then stick', async () => {
	const db = await database();
	try {
		await rememberGitHubProfile(db, 'Ada', { name: 'Ada L', company: '@engines' });
		assert.deepEqual(await publicName(db, 'ada'), { name: 'Ada L', affiliation: 'engines' });
		await editPublicName(db, 'Ada', { name: '  Augusta  Ada ', affiliation: '' });
		await rememberGitHubProfile(db, 'Ada', { name: 'GitHub Name', company: 'GitHub Co' });
		assert.deepEqual(await publicName(db, 'Ada'), { name: 'Augusta Ada', affiliation: '' });
		await editPublicName(db, 'zed', { affiliation: 'UCSD' });
		assert.deepEqual(await publicName(db, 'zed'), { name: '', affiliation: 'UCSD' });
	} finally { await db.close(); }
});

test('edits over the length limits are refused with a fix', async () => {
	const db = await database();
	try {
		await assert.rejects(editPublicName(db, 'ada', { name: 'x'.repeat(101) }), /at most 100/);
		await assert.rejects(editPublicName(db, 'ada', { affiliation: '学'.repeat(101) }), /at most 100/);
		await editPublicName(db, 'ada', { affiliation: '学'.repeat(100) });
	} finally { await db.close(); }
});

test('without the people table, nothing is shown and sign-in still works', async () => {
	const db = new PGlite();
	try {
		await rememberGitHubProfile(db, 'ada', { name: 'Ada' });
		assert.equal((await publicNames(db, ['ada'])).size, 0);
	} finally { await db.close(); }
});
