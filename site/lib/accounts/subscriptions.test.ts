import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { emptyDb, migrations } from '#lib/testing.ts';
import { QueryError } from '#lib/errors.ts';
import { SUBSCRIPTION_CATEGORIES } from '#lib/records/subscription-categories.ts';
import { profile } from './profile.ts';
import { createAgentKey, createSession, personFromSession, revokeKey } from './keys.ts';
import { homeFeed, homePage, saveSubscriptions, subscriptionPreferences, subscriptions, validateSubscriptions } from './subscriptions.ts';

let db: PGlite;
const ada = { login: 'Ada', agent: '', name: 'Ada' };
const bob = { login: 'bob', agent: '', name: 'Bob' };

before(async () => {
	db = emptyDb();
	await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
	for (const m of migrations()) await db.exec(m.sql);
});
after(() => db.close());

test('only catalog codes are accepted; duplicates normalize and an empty array clears', () => {
	assert.deepEqual(validateSubscriptions(['quant-ph', 'math.NT', 'quant-ph']), ['math.NT', 'quant-ph']);
	assert.deepEqual(validateSubscriptions([]), []);
	for (const input of [undefined, null, {}, 'math', [null], ['math.BAD'], [' math.NT'], ['__proto__'], ['cat:quant-ph OR cat:cs'], ['other'], Array(200).fill('math')]) {
		assert.throws(() => validateSubscriptions(input), QueryError);
	}
	for (const code of ['cs.AR', 'math.NT', 'quant-ph', 'physics.optics', 'hep-ex', 'q-fin.RM', 'math']) assert.ok(SUBSCRIPTION_CATEGORIES[code], code);
});

test('every picker category is permitted by the database constraint', async () => {
	const catalogOwner = { login: 'catalog-check', name: 'Catalog', agent: '' };
	const all = Object.keys(SUBSCRIPTION_CATEGORIES).sort();
	await saveSubscriptions(db, catalogOwner, catalogOwner.login, all);
	assert.deepEqual(await subscriptions(db, catalogOwner), all);
	await saveSubscriptions(db, catalogOwner, catalogOwner.login, []);
});

test('preferences persist across sessions and case changes, isolated by account; replacing and clearing are atomic', async () => {
	assert.deepEqual(await subscriptions(db, ada), []);
	await saveSubscriptions(db, ada, 'ada', ['math', 'quant-ph']);
	await saveSubscriptions(db, bob, 'bob', ['cs.LG']);
	const again = await personFromSession(db, await createSession(db, 'ADA'));
	assert.deepEqual(await subscriptions(db, again), ['math', 'quant-ph']);
	assert.deepEqual(await subscriptions(db, bob), ['cs.LG']);
	await assert.rejects(saveSubscriptions(db, ada, 'ada', ['math.BAD']), QueryError);
	assert.deepEqual(await subscriptions(db, ada), ['math', 'quant-ph']);
	await saveSubscriptions(db, ada, 'ada', ['math.NT']);
	assert.deepEqual(await subscriptions(db, ada), ['math.NT']);
	await saveSubscriptions(db, ada, 'ada', []);
	assert.deepEqual(await subscriptions(db, ada), []);
	assert.equal((await db.query("SELECT 1 FROM open_index.category_subscriptions WHERE login = 'ada'")).rows.length, 0);
	assert.deepEqual(await subscriptions(db, bob), ['cs.LG']);
});

test('changing subscriptions resets old page links; repeated navigation with the current revision works', async () => {
	await saveSubscriptions(db, ada, 'ada', ['math.NT']);
	const old = await subscriptionPreferences(db, ada);
	assert.equal(homePage('3', 'personal', old.revision, old.revision), 3);
	await saveSubscriptions(db, ada, 'ada', ['quant-ph']);
	const current = await subscriptionPreferences(db, ada);
	assert.notEqual(old.revision, current.revision);
	assert.equal(homePage('3', 'personal', old.revision, current.revision), 1);
	assert.equal(homePage('2', 'personal', undefined, current.revision), 1);
	for (const page of ['2', '1', '3', '2']) assert.equal(homePage(page, 'personal', current.revision, current.revision), Number(page));
	assert.equal(homePage('3', 'global', undefined, current.revision), 3);
});

test('auth interruption, agent keys, and account switches never write another account’s choices', async () => {
	await saveSubscriptions(db, ada, 'ada', ['quant-ph']);
	const revoked = await createSession(db, 'Ada');
	await revokeKey(db, 'Ada', { key: revoked });
	const expired = await createSession(db, 'Ada');
	await db.query("UPDATE open_index.agent_keys SET expires_at = now() - interval '1 second' WHERE revoked_at IS NULL");
	const agent = await createAgentKey(db, 'Ada', 'Research Agent');
	for (const key of [revoked, expired, agent, 'unknown']) {
		const result = await saveSubscriptions(db, await personFromSession(db, key), 'ada', ['math']);
		assert.equal(result.saved, false); assert.equal(result.signIn, true);
	}
	assert.equal((await saveSubscriptions(db, bob, 'ada', ['math'])).saved, false);
	assert.equal((await saveSubscriptions(db, { ...ada, agent: 'Research Agent' }, 'ada', ['math'])).saved, false);
	assert.deepEqual(await subscriptions(db, null), []);
	assert.deepEqual(await subscriptions(db, ada), ['quant-ph']);
	assert.deepEqual(await subscriptions(db, bob), ['cs.LG']);
});

test('anonymous and unsubscribed home defaults stay global; personal setup and zero matches never become global', () => {
	assert.deepEqual(homeFeed(null, [], 'personal'), { feed: 'global', categories: undefined });
	assert.deepEqual(homeFeed(ada, []), { feed: 'global', categories: undefined });
	assert.deepEqual(homeFeed(ada, [], 'personal'), { feed: 'personal', categories: [] });
	assert.deepEqual(homeFeed(ada, ['quant-ph']), { feed: 'personal', categories: ['quant-ph'] });
	assert.deepEqual(homeFeed(ada, ['quant-ph'], 'global'), { feed: 'global', categories: undefined });
});

test('preferences are excluded from public profiles and inaccessible to public database roles', async () => {
	const publicProfile = await profile(db, 'ada');
	assert.doesNotMatch(JSON.stringify(publicProfile), /quant-ph|categories|subscriptions/);
	assert.equal((await db.query<{ enabled: boolean }>("SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = 'open_index.category_subscriptions'::regclass")).rows[0].enabled, true);
	for (const role of ['anon', 'authenticated']) {
		for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
			assert.equal((await db.query<{ allowed: boolean }>("SELECT has_table_privilege($1, 'open_index.category_subscriptions', $2) AS allowed", [role, privilege])).rows[0].allowed, false);
		}
	}
	await assert.rejects(db.query("INSERT INTO open_index.category_subscriptions (login, categories) VALUES ('bad', ARRAY['math.BAD'])"), /check constraint/);
});
