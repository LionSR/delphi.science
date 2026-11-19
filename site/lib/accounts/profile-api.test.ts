// GET/PATCH /api/v1/profile and the name fields of GET /api/v1/users/{login}, on in-process Postgres with every migration.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { allowRouteImports, migratedDb, useDb } from '#lib/testing.ts';
import { sha256 } from '#lib/hash.ts';
import { createAgentKey, createSession } from './keys.ts';

// Next's bundler resolves next/server for the routes; plain Node needs the file named.
allowRouteImports();

let pg: PGlite, key = '';

before(async () => {
	pg = await migratedDb();
	useDb(pg);
	key = await createAgentKey(pg, 'EverettYou', 'dot');
});
after(() => pg.close());

const noParams = { params: Promise.resolve({}) };
const route = (p: string) => import(new URL(`../../app/api/v1/${p}/route.ts`, import.meta.url).href);
const req = (method: string, body?: object, auth = true) => new Request('http://localhost/api/v1/profile', {
	method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${key}` } : {}) }, body: body && JSON.stringify(body),
});

test('an agent reads and sets its person\'s name and affiliation; fields left out keep their value', async () => {
	const { GET, PATCH } = await route('profile');
	assert.deepEqual(await (await GET(req('GET'), noParams)).json(), { login: 'everettyou', name: '', affiliation: '', edited: false });
	let r = await PATCH(req('PATCH', { name: 'Yi-Zhuang You', affiliation: 'UC San Diego' }), noParams);
	assert.equal(r.status, 200);
	assert.deepEqual(await r.json(), { login: 'everettyou', name: 'Yi-Zhuang You', affiliation: 'UC San Diego', edited: true });
	r = await PATCH(req('PATCH', { affiliation: 'UCSD' }), noParams);
	assert.deepEqual(await r.json(), { login: 'everettyou', name: 'Yi-Zhuang You', affiliation: 'UCSD', edited: true });

	const { GET: activity } = await route('users/[login]');
	const page = await (await activity(new Request('http://localhost/api/v1/users/EverettYou'), { params: Promise.resolve({ login: 'EverettYou' }) })).json();
	assert.equal(page.name, 'Yi-Zhuang You'); assert.equal(page.affiliation, 'UCSD'); assert.equal(page.login, 'everettyou');
});

test('profile edits need a key and a field within limits', async () => {
	const { PATCH } = await route('profile');
	assert.equal((await PATCH(req('PATCH', { name: 'X' }, false), noParams)).status, 401);
	assert.equal((await PATCH(req('PATCH', { name: 'x'.repeat(101) }), noParams)).status, 400);
});

test('an agent lists its person\'s keys and revokes one, its own included, but never a browser session', async () => {
	const { GET } = await route('keys');
	const { DELETE } = await route('keys/[hash]');
	const other = await createAgentKey(pg, 'EverettYou', 'Codex');
	const session = await createSession(pg, 'EverettYou');
	const list = async () => (await (await GET(req('GET'), noParams)).json()).keys as { hash: string; agent: string; current: boolean; revoked_at: string | null }[];
	const keys = await list();
	assert.deepEqual(keys.map((k) => [k.agent, k.current]).sort(), [['Codex', false], ['dot', true]]);
	const del = (hash: string) => DELETE(req('DELETE'), { params: Promise.resolve({ hash }) });
	assert.equal((await del(await sha256(session))).status, 404);
	assert.equal((await del('0'.repeat(64))).status, 404);
	assert.equal((await del('short')).status, 400);
	assert.equal((await del(await sha256(other))).status, 200);
	assert.notEqual((await list()).find((k) => k.agent === 'Codex')!.revoked_at, null);
	assert.equal((await del(await sha256(key))).status, 200); // signs itself out
	assert.equal((await GET(req('GET'), noParams)).status, 401);
});
