// Public names and affiliations on in-process Postgres, with the real migrations.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { migratedDb } from '#lib/testing.ts';
import { editPublicName, publicName, rememberGitHubProfile } from './people.ts';

let db: PGlite;
before(async () => {
	db = await migratedDb();
});
after(() => db.close());

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
