// Claims from the peer-to-peer network: what a bridge may store, and what a record page shows of it. On in-process
// Postgres with every migration.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { allowRouteImports, migratedDb, useDb } from '#lib/testing.ts';
import { createAgentKey } from '#lib/accounts/keys.ts';
import type { Db } from '#lib/db.ts';
import { artifacts, canRelay, store, type ClaimEntry, type FileEntry } from './claims.ts';

// Next's bundler resolves next/server for the routes; plain Node needs the file named.
allowRouteImports();

let pg: PGlite;
before(async () => { pg = await migratedDb(); useDb(pg); });
after(() => pg.close());

// Ids, keys and snapshot hashes are 64 hex digits; these repeat one digit.
const hex = (digit: string) => digit.repeat(64);
const [ann, ben, cy, seed] = ['a', 'b', 'c', 'd'].map(hex);
const [one, two] = ['1', '2'].map(hex);
let seq = 0;
const entry = (id: string, author: string, kind: string, data: Record<string, unknown>, refs: string[] = []): ClaimEntry =>
	({ seq: ++seq, id: hex(id), author, micros: 1_795_000_000_000_000 + seq, claim: { kind, refs: refs.map(hex), data } });
const publish = (id: string, author: string, snapshot: string, refs: string[] = [], source?: string) =>
	entry(id, author, 'publish', { title: 'A title nobody is shown', snapshot, files: 4, bytes: 1536, ...(source ? { source } : {}) }, refs);
const check = (id: string, author: string, version: string, snapshot: string, result: string) =>
	entry(id, author, 'check', { snapshot, checker: 'lake check', toolchain: 'leanprover/lean4:v4.36.0', runner: 'bwrap', result, exit_code: result === 'pass' ? 0 : 1 }, [version]);
const file = (path: string, digit: string): FileEntry => ({ path, bytes: 10, hash: hex(digit) });
const bridge = { login: 'bridge', agent: 'p2p bridge' };

test('a batch is stored once, and a publish claim attaches to the record its source names', async () => {
	const batch = [publish('0', ann, one, [], 'https://arxiv.org/abs/2610.20058'), entry('9', seed, 'gossip', { anything: true })];
	// The reply asks for the file list of the version it just learned of.
	assert.deepEqual(await store(pg, { entries: batch }, bridge), { stored: 2, known: 0, through: seq, wanted: [hex('0')] });
	assert.deepEqual(await store(pg, { entries: batch }, bridge), { stored: 0, known: 2, through: seq, wanted: [hex('0')] });
	const { rows } = await pg.query<{ record_id: string | null; received_from: string }>("SELECT record_id, received_from FROM open_index.claims WHERE id = $1", [hex('0')]);
	assert.deepEqual(rows, [{ record_id: 'arxiv/2610.20058', received_from: 'bridge' }]);
	assert.deepEqual(await store(pg, { entries: [] }, bridge), { stored: 0, known: 0, through: null, wanted: [hex('0')] });
});

test('a record shows its versions, forks, holders, and one verdict per key for each snapshot', async () => {
	await store(pg, { entries: [
		entry('3', ann, 'have', { snapshot: one }), entry('4', seed, 'have', { snapshot: one }),
		check('5', ben, '0', one, 'pass'), check('6', cy, '0', one, 'fail'), check('7', cy, '0', one, 'pass'),
		publish('e', ann, two, ['0']),            // the author's second version
		publish('f', ben, two, ['0']),            // another key's version of the first
		check('8', cy, 'e', two, 'fail'),
		check('a', cy, 'e', one, 'pass'),         // names the new version but another snapshot: not counted
	] }, bridge);
	const [artifact, ...rest] = await artifacts(pg, 'arxiv/2610.20058');
	assert.equal(rest.length, 0);
	assert.equal(artifact.id, hex('0'));
	assert.deepEqual(artifact.versions.map(({ id, state, holders, pass, fail, lean, files, bytes }) => ({ id: id[0], state, holders, pass, fail, lean, files, bytes })), [
		{ id: '0', state: 'earlier', holders: 2, pass: 2, fail: 0, lean: ['v4.36.0'], files: 4, bytes: 1536 },
		{ id: 'e', state: 'current', holders: 0, pass: 0, fail: 1, lean: ['v4.36.0'], files: 4, bytes: 1536 },
		{ id: 'f', state: 'fork', holders: 0, pass: 0, fail: 0, lean: [], files: 4, bytes: 1536 },
	]);
	assert.deepEqual(await artifacts(pg, 'arxiv/0000.00000'), []);
});

test('a version lists its files once a bridge has sent them, with what changed since the version before', async () => {
	assert.equal((await artifacts(pg, 'arxiv/2610.20058'))[0].versions.every((v) => v.listing === null), true);
	const { wanted } = await store(pg, { entries: [], snapshots: [
		{ hash: one, files: [file('Old.lean', '1'), file('Toy.lean', '2'), file('lakefile.toml', '3')] },
		{ hash: two, files: [file('New.lean', '4'), file('Toy.lean', '5'), file('lakefile.toml', '3'), file('<b>.lean', '6')] },
		{ hash: hex('7'), files: [file('Stray.lean', '8')] },   // no version names this snapshot: not kept
	] }, bridge);
	assert.deepEqual(wanted, []);
	assert.equal((await pg.query('SELECT 1 FROM open_index.snapshots')).rows.length, 2);
	const [{ versions }] = await artifacts(pg, 'arxiv/2610.20058');
	const lines = (v: typeof versions[number]) => v.listing!.files.map((f) => `${f.path} ${f.change ?? ''}`.trimEnd());
	assert.deepEqual(versions[0].listing, { after: null, more: 0, unshown: 0,
		files: ['Old.lean', 'Toy.lean', 'lakefile.toml'].map((path) => ({ path, bytes: 10, change: null })) });
	// What changed comes first; the name with markup in it is counted and not shown.
	assert.deepEqual(lines(versions[1]), ['New.lean added', 'Old.lean removed', 'Toy.lean changed', 'lakefile.toml']);
	assert.deepEqual([versions[1].listing!.after, versions[1].listing!.unshown], [hex('0'), 1]);
});

test('only a key of a listed bridge account may hand over claims', async () => {
	assert.equal(canRelay(bridge, 'Bridge, other'), true);
	assert.equal(canRelay(bridge, ''), false);
	assert.equal(canRelay(undefined, 'bridge'), false);

	const { POST } = await import(new URL('../../app/api/v1/claims/route.ts', import.meta.url).href);
	const send = async (key: string, body: object) => POST(new Request('http://localhost/api/v1/claims', {
		method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body),
	}), { params: Promise.resolve({}) });
	const batch = { entries: [entry('b', ann, 'have', { snapshot: two })] };
	assert.equal((await send('', batch)).status, 401);
	process.env.P2P_BRIDGE_LOGINS = 'bridge';
	try {
		assert.equal((await send(await createAgentKey(pg, 'someone', 'an agent'), batch)).status, 403);
		const key = await createAgentKey(pg, 'bridge', 'p2p bridge');
		const reply = await send(key, batch);
		assert.equal(reply.status, 200);
		assert.deepEqual(await reply.json(), { stored: 1, known: 0, through: seq, wanted: [] });
		// An id that is not a hash is refused before anything is stored.
		assert.equal((await send(key, { entries: [{ ...batch.entries[0], id: 'not-a-hash' }] })).status, 400);
	} finally {
		delete process.env.P2P_BRIDGE_LOGINS;
	}
});

// The production driver, postgres.js, encodes a string given for a jsonb parameter once more, as one jsonb string.
// The in-process database takes either, so it cannot show the difference: this looks at what the driver is handed.
test('JSON goes to the database as values, never as text', async () => {
	const asText: string[] = [];
	const watched = { query: (sql: string, params: unknown[] = []) => {
		for (const [, n] of sql.matchAll(/\$(\d+)::jsonb/g)) if (typeof params[Number(n) - 1] === 'string') asText.push(sql.trim().slice(0, 40));
		return pg.query(sql, params);
	} } as Db;
	await store(watched, { entries: [entry('c', ann, 'have', { snapshot: two })], snapshots: [{ hash: two, files: [file('A.lean', '7')] }] }, bridge);
	assert.deepEqual(asText, []);
});
