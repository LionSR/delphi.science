// Search and votes on PGlite with the migrations. Needs a build: python3 indexer/index.py build.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { compile, get, parse, search } from './query.ts';
import { load, type Item } from './load.ts';
import { agentKeys, createAgentKey, createSession, revokeKey, voterFromKey } from '#lib/accounts/keys.ts';
import { unvote, vote as actualVote } from './votes.ts';
import { comment as actualComment, comments } from '#lib/posts/comments.ts';
import { approveDevice, denyDevice, pendingDevice, redeemDevice, startDevice } from '#lib/accounts/device.ts';
import { BUILD, buildItems, migratedDb } from '#lib/testing.ts';

const yes = async () => ({ decision: 'ACCEPT' as const, reason: 'Test fixture only.', verification_needed: false });
const comment: typeof actualComment = (db, id, voter, c, moderate = yes) => actualComment(db, id, voter, c, moderate);
const vote: typeof actualVote = (db, id, voter, v, moderate = yes) => actualVote(db, id, voter, v, moderate);

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
});

describe('on Postgres', { skip: !existsSync(BUILD) && 'build the index first' }, () => {
	let db: PGlite;
	let items: Item[] = [];
	before(async () => {
		db = await migratedDb();
		items = buildItems();
		assert.equal(await load(db, items), items.length);
	});

	test('structured filters match the build exactly', async () => {
		const expect = (pred: (it: Item) => boolean) => items.filter(pred).length;
		const cases: [string, number][] = [
			['cat:math', expect((it) => it.division === 'math')],
			['cat:math.NT', expect((it) => it.subject === 'math.NT')],
			['is:withdrawn', expect((it) => Boolean(it.withdrawn))],
			['source:app', expect((it) => it.source === 'app')],
			['is:verified cat:math.NT', expect((it) => Boolean(it.verified) && it.subject === 'math.NT')],
			['source:openai-math ANDNOT is:withdrawn', expect((it) => it.source === 'openai-math' && !it.withdrawn)],
		];
		for (const [q, n] of cases) assert.equal((await search(db, q)).total, n, q);
	});

	test('text search finds, ranks and pages', async () => {
		const r = await search(db, 'ti:lattice', { limit: 2 });
		assert.ok(r.total >= 4 && r.results.every((x) => /lattice/i.test(String(x.title))));
		const page2 = await search(db, 'ti:lattice', { limit: 2, cursor: r.next_cursor });
		assert.notDeepEqual(page2.results.map((x) => x.id), r.results.map((x) => x.id));
		const numbered = await search(db, 'ti:lattice', { limit: 2, page: 2 });
		assert.deepEqual([numbered.total, numbered.results], [r.total, page2.results], 'a numbered page matches the cursor page');
		assert.ok((await search(db, 'au:claude')).results.some((x) => String(x.title).startsWith('Zeta23')));
		assert.ok((await search(db, '"zero-free"')).total >= 1);
		assert.ok((await search(db, 'lattice*')).total >= r.total);
	});

	test('votes: up or down, an emoji, a note; one per voter; never on your own repo', async () => {
		const id = String(items.find((it) => it.source === 'openai-math' && !it.discussion)!.id);
		const alice = { login: 'alice', agent: 'Claude Code' }, bob = { login: 'bob', agent: 'ChatGPT dot' };
		await vote(db, id, alice, { value: 1, emoji: '🤔', note: 'Lemma 3 needs a citation.' });
		let t = await vote(db, id, bob, { value: -1 });
		assert.deepEqual([t.score, t.reactions], [0, { up: 1, down: 1, '🤔': 1 }]);
		t = await vote(db, id, bob, { value: 1, emoji: '👀' }); // a second vote replaces the first
		assert.deepEqual([t.score, t.reactions], [2, { up: 2, '🤔': 1, '👀': 1 }]);
		t = await unvote(db, id, alice);
		assert.deepEqual([t.score, t.reactions], [1, { up: 1, '👀': 1 }]);
		assert.equal((await search(db, 'source:openai-math ANDNOT is:discussed', { sort: 'score', limit: 1 })).results[0].id, id);
		assert.equal((await get(db, id))?.score, 1);
		const own = items.find((it) => it.source === 'app')!;
		const owner = String(own.repo).split('/')[3];
		await assert.rejects(vote(db, own.id, { login: owner, agent: '' }, { value: 1 }), /own repository/);
		const updated = (await db.query<{ n: number }>("SELECT count(*)::int n FROM open_index.changes WHERE kind = 'updated'")).rows[0].n;
		assert.equal(updated, 0, 'votes are not content changes');
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

	test('hybrid ranking puts the nearest embedding first', async () => {
		const dims = 1024;
		const unit = (k: number) => Array.from({ length: dims }, (_, i) => (i === k ? 1 : 0));
		const ids = items.filter((it) => it.source === 'openai-math').slice(0, 3).map((it) => it.id);
		for (const [k, id] of ids.entries()) await db.query('UPDATE open_index.records SET embedding = $1::extensions.vector WHERE id = $2', [`[${unit(k)}]`, id]);
		const r = await search(db, 'source:openai-math', { embedding: unit(1), limit: 3 });
		assert.equal(r.results[0].id, ids[1]);
	});
});
