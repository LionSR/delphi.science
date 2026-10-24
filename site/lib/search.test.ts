// The open index on real Postgres (PGlite: Postgres compiled to WebAssembly, with pgvector), using the
// migration as written. Needs a build of the index first: python3 index.py build.
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { compile, get, parse, QueryError, search } from './query.ts';
import { load, type Item } from './load.ts';
import { agentKeys, createAgentKey, createSession, myVotes, revokeKey, unvote, vote, voterFromKey } from './votes.ts';
import { comment, comments } from './comments.ts';
import { approveDevice, denyDevice, pendingDevice, redeemDevice, startDevice } from './device.ts';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const INDEX = new URL('../../dist/index.json', import.meta.url);

describe('query syntax', () => {
	test('parses arXiv-style operators', () => {
		assert.deepEqual(parse('ti:a ANDNOT b'), { op: 'AND', kids: [{ field: 'ti', value: 'a', phrase: false }, { op: 'NOT', kids: [{ field: '', value: 'b', phrase: false }] }] });
		assert.equal((parse('(a OR b) c') as { op: string }).op, 'AND');
	});
	test('user text is always a parameter', () => {
		const { where, params } = compile(`ti:"x'; drop table y; --" OR source:z`);
		assert.ok(!where.includes('drop'));
		assert.deepEqual(params, [`x'; drop table y; --`, 'z']);
	});
	test('errors say how to fix the query', () => {
		for (const [q, fix] of [['foo:bar', /Use one of/], ['is:nope', /is:formalized/], ['AND x', /term before/], ['(a', /missing/],
			['published:[2026-13 TO *]', /YYYY-MM/], ['', /Send q/]] as const) {
			assert.throws(() => compile(q), (e: unknown) => e instanceof QueryError && fix.test(e.fix), q);
		}
	});
	test('subjects: codes, divisions and names', () => {
		assert.match(compile('cat:math.NT').where, /r\.subject = \$1/);
		assert.deepEqual(compile('cat:"number theory"').params[0], 'math.NT');
		assert.match(compile('cat:"something else"').where, /r\.domain/);
	});
});

describe('on Postgres', { skip: !existsSync(INDEX) && 'build the index first' }, () => {
	const db = new PGlite({ extensions: { vector } });
	let items: Item[] = [];
	before(async () => {
		for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
		items = JSON.parse(readFileSync(INDEX, 'utf8')).items;
		assert.equal(await load(db, items), items.length);
	});

	test('records are stored as JSON objects', async () => {
		const t = (await db.query<{ t: string }>('SELECT DISTINCT jsonb_typeof(record) AS t FROM open_index.records')).rows.map((r) => r.t);
		assert.deepEqual(t, ['object']);
	});

	test('a second load with nothing changed writes nothing', async () => {
		assert.equal(await load(db, items), 0);
		const added = (await db.query<{ n: number }>("SELECT count(*)::int n FROM open_index.changes WHERE kind = 'added'")).rows[0].n;
		assert.equal(added, items.length);
	});

	test('structured filters match the build exactly', async () => {
		const expect = (pred: (it: Item) => boolean) => items.filter(pred).length;
		const cases: [string, number][] = [
			['cat:math', expect((it) => it.division === 'math')],
			['cat:math.NT', expect((it) => it.subject === 'math.NT')],
			['cat:"number theory"', expect((it) => it.subject === 'math.NT')],
			['is:withdrawn', expect((it) => Boolean(it.withdrawn))],
			['source:app', expect((it) => it.source === 'app')],
			['is:verified cat:math.NT', expect((it) => Boolean(it.verified) && it.subject === 'math.NT')],
			['source:openai-math ANDNOT is:withdrawn', expect((it) => it.source === 'openai-math' && !it.withdrawn)],
		];
		for (const [q, n] of cases) assert.equal((await search(db, q)).total, n, q);
	});

	test('text search finds, ranks and pages', async () => {
		const r = await search(db, 'ti:grokking', { limit: 2 });
		assert.ok(r.total >= 4 && r.results.every((x) => /grok/i.test(String(x.title))));
		const page2 = await search(db, 'ti:grokking', { limit: 2, cursor: r.next_cursor });
		assert.notDeepEqual(page2.results.map((x) => x.id), r.results.map((x) => x.id));
		assert.ok((await search(db, 'au:claude')).results.some((x) => String(x.title).startsWith('Zeta23')));
		assert.ok((await search(db, '"zero-free"')).total >= 1);
		assert.ok((await search(db, 'grok*')).total >= r.total);
	});

	test('one record by id', async () => {
		assert.equal((await get(db, 'app/APP-260923-0000'))?.title, 'Blast freezing a black hole');
		assert.equal(await get(db, 'nope/x'), null);
	});

	test('votes: up or down, an emoji, a note; one per voter; never on your own repo', async () => {
		const id = String(items.find((it) => it.source === 'openai-math')!.id);
		const alice = { login: 'alice', agent: 'Claude Code' }, bob = { login: 'bob', agent: 'ChatGPT dot' };
		await vote(db, id, alice, { value: 1, emoji: '🤔', note: 'Lemma 3 needs a citation.' });
		let t = await vote(db, id, bob, { value: -1 });
		assert.deepEqual([t.score, t.reactions], [0, { up: 1, down: 1, '🤔': 1 }]);
		t = await vote(db, id, bob, { value: 1, emoji: '👀' }); // a second vote replaces the first
		assert.deepEqual([t.score, t.reactions], [2, { up: 2, '🤔': 1, '👀': 1 }]);
		t = await unvote(db, id, alice);
		assert.deepEqual([t.score, t.reactions], [1, { up: 1, '👀': 1 }]);
		assert.equal((await search(db, 'source:openai-math', { sort: 'score', limit: 1 })).results[0].id, id);
		assert.equal((await get(db, id))?.score, 1);
		for (const [v, fix] of [[{}, /value/], [{ value: 2 }, /up/], [{ emoji: 'ok' }, /single emoji/]] as const) {
			await assert.rejects(vote(db, id, alice, v as never), (e: unknown) => e instanceof QueryError && fix.test(e.fix));
		}
		const own = items.find((it) => it.source === 'app')!;
		const owner = String(own.repo).split('/')[3];
		await assert.rejects(vote(db, own.id, { login: owner, agent: '' }, { value: 1 }), /own repository/);
		const added = (await db.query<{ n: number }>("SELECT count(*)::int n FROM open_index.changes WHERE kind = 'updated'")).rows[0].n;
		assert.equal(added, 0, 'votes are not content changes');
	});

	test('comments and reviews; mentions count once per voter, never for the record itself', async () => {
		const [a, b] = items.filter((it) => it.source === 'palomar').slice(0, 2).map((it) => it.id);
		const app = items.find((it) => it.source === 'app')!;
		const alice = { login: 'alice', agent: 'Claude Code' }, bob = { login: 'bob', agent: 'Grok bot' };
		const r = await comment(db, a, alice, { body: `Checked the Lean statement; it matches ${app.id}. Also see ${a}.`, review: true });
		assert.deepEqual(r.mentions, [app.id]);
		await comment(db, b, alice, { body: `Same construction as ${app.url}` }); // the same voter again: still one mention
		await comment(db, b, bob, { body: `Agree; builds on ${app.id}.`, parent: undefined });
		const reply = await comment(db, a, bob, { body: 'Thanks, confirmed.', parent: r.id });
		assert.equal(reply.parent, r.id);
		const rec = await get(db, app.id);
		assert.deepEqual([rec?.mentions, rec?.comments], [2, 0]);
		assert.deepEqual([(await get(db, a))?.comments, (await get(db, a))?.reviews], [2, 1]);
		assert.equal((await comments(db, a)).length, 2);
		assert.equal((await search(db, 'source:app', { sort: 'mentions', limit: 1 })).results[0].id, app.id);
		await assert.rejects(comment(db, a, bob, { body: ' ' }), /empty/);
		await assert.rejects(comment(db, a, bob, { body: 'x', parent: 999999 }), /no comment/);
	});

	test('agent keys: created once, stored as a hash, revocable', async () => {
		const key = await createAgentKey(db, 'carol', 'Grok bot');
		assert.match(key, /^oik_[0-9a-f]{48}$/);
		assert.deepEqual(await voterFromKey(db, key), { login: 'carol', agent: 'Grok bot' });
		assert.equal((await db.query("SELECT 1 FROM open_index.agent_keys WHERE key_hash = $1", [key])).rows.length, 0);
		const session = await createSession(db, 'carol');
		assert.deepEqual(await voterFromKey(db, session), { login: 'carol', agent: '' });
		const listed = await agentKeys(db, 'carol');
		assert.deepEqual(listed.map((k) => k.agent), ['Grok bot'], 'sessions are not listed as agent keys');
		await revokeKey(db, 'dave', { hash: listed[0].hash }); // only the owner can revoke
		assert.ok(await voterFromKey(db, key));
		await revokeKey(db, 'carol', { hash: listed[0].hash });
		await revokeKey(db, 'carol', { key: session });
		assert.deepEqual([await voterFromKey(db, key), await voterFromKey(db, session)], [null, null]);
		const leaked = await createAgentKey(db, 'carol', 'Codex');
		await assert.rejects(comment(db, items[0].id, { login: 'carol', agent: 'Codex' }, { body: `my key is ${leaked}` }), /contains an agent key/);
		assert.equal(await voterFromKey(db, leaked), null, 'a posted key is revoked');
	});

	test('device flow: the agent gets its key itself, once, after its person approves', async () => {
		const d = await startDevice(db, 'Claude Code');
		assert.match(d.user_code, /^[B-Z]{4}-[B-Z]{4}$/);
		assert.equal(await redeemDevice(db, d.device_code), 'pending');
		assert.deepEqual(await pendingDevice(db, d.user_code.toLowerCase()), { agent: 'Claude Code', login: null });
		await approveDevice(db, d.user_code, 'gina');
		await assert.rejects(approveDevice(db, d.user_code, 'mallory'), /already used/);
		const got = await redeemDevice(db, d.device_code);
		assert.ok(got !== 'pending');
		assert.deepEqual(await voterFromKey(db, got.key), { login: 'gina', agent: 'Claude Code' });
		await assert.rejects(redeemDevice(db, d.device_code), /used/);
		const denied = await startDevice(db, 'Grok bot');
		await denyDevice(db, denied.user_code);
		await assert.rejects(redeemDevice(db, denied.device_code), /denied/);
		await db.query("UPDATE open_index.agent_keys SET expires_at = now() - interval '1 day' WHERE login = 'gina'");
		assert.equal(await voterFromKey(db, got.key), null, 'keys expire');
	});

	test('top today, this week, this month: votes cast in that time', async () => {
		const [old, fresh] = items.filter((it) => it.source === 'jaigp').slice(0, 2).map((it) => String(it.id));
		const erin = { login: 'erin', agent: '' }, finn = { login: 'finn', agent: '' };
		await vote(db, old, erin, { value: 1 });
		await vote(db, old, finn, { value: 1 });
		await db.query("UPDATE open_index.votes SET at = now() - interval '10 days' WHERE record_id = $1", [old]);
		await vote(db, fresh, erin, { value: 1 });
		const top = async (sort: string) => (await search(db, 'source:jaigp', { sort, limit: 1 })).results[0].id;
		assert.deepEqual([await top('week'), await top('month'), await top('score')], [fresh, old, old]);
		assert.equal((await myVotes(db, 'erin', [old, fresh, 'nope/x'])).get(fresh)?.value, 1);
	});

	test('hybrid ranking puts the nearest embedding first', async () => {
		const dims = 1024;
		const unit = (k: number) => Array.from({ length: dims }, (_, i) => (i === k ? 1 : 0));
		const ids = items.filter((it) => it.source === 'openai-math').slice(0, 3).map((it) => it.id);
		for (const [k, id] of ids.entries()) await db.query('UPDATE open_index.records SET embedding = $1::extensions.vector WHERE id = $2', [`[${unit(k)}]`, id]);
		const r = await search(db, 'source:openai-math', { embedding: unit(1), limit: 3 });
		assert.equal(r.results[0].id, ids[1]);
	});
});
