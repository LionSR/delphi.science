// Public names and affiliations on in-process Postgres, with the real migrations.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import type { Db } from '../db.ts';
import { migratedDb, migrations } from '../testing.ts';
import { editPublicName, profileAffiliation, publicName, publicNames, rememberGitHubProfile } from './people.ts';

let db: PGlite;
before(async () => {
	db = await migratedDb();
	// Sessions from before the people table; rerunning its migration seeds people from them.
	await db.exec(`INSERT INTO open_index.agent_keys (key_hash, login, agent, name, created_at) VALUES
		('a', 'Ada', '', 'Old Name', now() - interval '1 day'), ('b', 'Ada', '', 'Ada Lovelace', now()),
		('c', 'bob', 'Claude Code', 'Agent Name', now()), ('d', 'cy', '', 'cy', now())`);
	await db.exec(migrations().find((m) => m.name.endsWith('_people.sql'))!.sql);
});
after(() => db.close());

test('affiliations drop GitHub\'s leading @ only before a name', () => {
	assert.equal(profileAffiliation('  @anthropic '), 'anthropic');
	assert.equal(profileAffiliation('@'), '@');
	assert.equal(profileAffiliation(null), '');
});

test('the migration starts from the newest named sign-in; lookups ignore login case and drop bare logins', async () => {
	assert.deepEqual(Object.fromEntries(await publicNames(db, ['ADA', 'ada', 'bob', 'cy'])),
		{ ADA: { name: 'Ada Lovelace', affiliation: '' }, ada: { name: 'Ada Lovelace', affiliation: '' } });
	assert.equal((await publicNames(db, [])).size, 0);
	assert.deepEqual(await publicName(db, 'nobody'), { name: '', affiliation: '' });
});

test('sign-in copies GitHub until the person edits; their edits, even blank ones, then stick', async () => {
	await rememberGitHubProfile(db, 'Grace', { name: 'G. Hopper', company: 'Navy' });
	await rememberGitHubProfile(db, 'Grace', { name: 'Grace H', company: '@cobol' });
	assert.deepEqual(await publicName(db, 'grace'), { name: 'Grace H', affiliation: 'cobol' });
	await editPublicName(db, 'Grace', { name: '  Grace  Hopper ', affiliation: '' });
	await rememberGitHubProfile(db, 'Grace', { name: 'GitHub Name', company: 'GitHub Co' });
	assert.deepEqual(await publicName(db, 'Grace'), { name: 'Grace Hopper', affiliation: '' });
	await editPublicName(db, 'zed', { affiliation: 'UCSD' });
	assert.deepEqual(await publicName(db, 'zed'), { name: '', affiliation: 'UCSD' });
});

test('edits over the length limits are refused', async () => {
	await assert.rejects(editPublicName(db, 'kay', { name: 'x'.repeat(101) }), /longer than 100/);
	await assert.rejects(editPublicName(db, 'kay', { affiliation: '学'.repeat(101) }), /longer than 100/);
	await editPublicName(db, 'kay', { affiliation: '学'.repeat(100) });
});

test('a failed lookup shows no names, and a failed copy never fails sign-in', async () => {
	const down: Db = { query: async () => { throw new Error('offline'); } };
	await rememberGitHubProfile(down, 'ada', { name: 'Ada' });
	assert.equal((await publicNames(down, ['ada'])).size, 0);
});
