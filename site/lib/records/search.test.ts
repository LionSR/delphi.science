// Search and votes on PGlite with the migrations. Needs a build: python3 index.py build.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { compile, get, IS, parse, QUERY_FIELDS, search, SORT_HELP, SORTS } from './query.ts';
import { QueryError } from '#lib/errors.ts';
import { load, type Item } from './load.ts';
import { agentKeys, createAgentKey, createSession, revokeKey, voterFromKey } from '#lib/accounts/keys.ts';
import { myVotes, unvote, vote as actualVote } from './votes.ts';
import { comment as actualComment, comments } from '#lib/posts/comments.ts';
import { approveDevice, denyDevice, pendingDevice, redeemDevice, startDevice } from '#lib/accounts/device.ts';
import { handle as mcp } from '#lib/api/mcp.ts';
import { fileCount, MAX_URLS, sitemapFile, sitemapFiles } from './sitemap.ts';
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
	test('the docs describe the language as it compiles: every field, flag and sort they name is real', () => {
		for (const f of Object.keys(QUERY_FIELDS).flatMap((g) => g.split(' '))) assert.doesNotThrow(() => compile(`${f}:${f === 'is' ? 'discussed' : '2026'}`), f);
		for (const flag of Object.keys(IS)) assert.doesNotThrow(() => compile(`is:${flag}`), flag);
		for (const s of SORTS) assert.match(SORT_HELP, new RegExp(`(^|, )${s}\\b`), s);
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
	// Sets a record's links (record.discussion), as index.py discuss does; pair queries two palomar records.
	const discuss = (id: string, links: object[]) =>
		db.query("UPDATE open_index.records SET record = jsonb_set(record, '{discussion}', $2::jsonb) WHERE id = $1", [id, JSON.stringify(links)]);
	const pair = (a: string, b: string) => `source:palomar AND (id:${JSON.stringify(a)} OR id:${JSON.stringify(b)})`;

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

	test('the sitemap lists every record once, at most 50,000 URLs a file, each with its last change', async () => {
		const files = await sitemapFiles(db);
		assert.equal(files, fileCount(items.length));
		const seen = new Set<string>();
		for (let n = 0; n < files; n++) {
			const urls = await sitemapFile(db, 'https://x.org', n);
			assert.ok(urls.length <= MAX_URLS, `file ${n} has ${urls.length} URLs`);
			for (const u of urls.filter((u) => u.loc.startsWith('https://x.org/r/'))) {
				assert.match(String(u.lastmod), /^\d{4}-\d{2}-\d{2}T/);
				assert.ok(!seen.has(u.loc), `${u.loc} is listed twice`);
				seen.add(u.loc);
			}
		}
		assert.equal(seen.size, items.length);
		assert.equal((await sitemapFile(db, 'https://x.org', files)).length, 0);
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

	test('posts and articles about a record count like upvotes and show as discussed', async () => {
		const discussed = items.filter((it) => Array.isArray(it.discussion) && it.discussion.length > 0);
		assert.ok(discussed.length > 0, 'the build has records with discussion');
		const r = await search(db, 'is:discussed', { sort: 'score', limit: 50 });
		assert.equal(r.total, discussed.length);
		const most = Math.max(...discussed.map((it) => (it.discussion as unknown[]).length));
		assert.equal(r.results[0].discussed, most); // no votes yet: the posts alone rank it first
	});

	test('in day, week and month a post counts on the day it was posted, not the day it was linked', async () => {
		const [a, b] = items.filter((it) => it.source === 'palomar').slice(2, 4).map((it) => String(it.id));
		const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
		const today = ago(0);
		const links = (dates: string[]) => dates.map((date, i) => ({ kind: 'web', url: `https://e.org/${i}`, date, added: today }));
		await discuss(a, links([ago(20), ago(21)]));
		await discuss(b, links([today]));
		const top = async (sort: string) => (await search(db, pair(a, b), { sort, limit: 1 })).results[0].id;
		assert.deepEqual([await top('week'), await top('month'), await top('score')], [b, a, a]); // both were linked today
		assert.equal(await top('responded'), b);
	});

	test('responded: the record with the newest response first, then the ones without', async () => {
		const latest = (it: Item) => Math.max(...(it.discussion as { date?: string; added: string }[]).map((d) => Date.parse(d.date || d.added)));
		const discussed = items.filter((it) => it.source === 'openai-math' && Array.isArray(it.discussion) && it.discussion.length);
		const r = await search(db, 'source:openai-math', { sort: 'responded', limit: 20 });
		const byId = new Map(items.map((it) => [it.id, it]));
		assert.deepEqual(r.results.map((x) => latest(byId.get(String(x.id))!)), discussed.map(latest).sort((x, y) => y - x).slice(0, 20));
		const after = await search(db, 'source:openai-math', { sort: 'responded', limit: 1, cursor: btoa(JSON.stringify({ o: discussed.length, t: r.total })) });
		assert.ok(!after.results[0].discussed);
	});

	test('only responses that confirm, simplify or extend count as upvotes; refutes and questions mark it disputed', async () => {
		const [a, b] = items.filter((it) => it.source === 'palomar').slice(4, 6).map((it) => String(it.id));
		const today = new Date().toISOString().slice(0, 10);
		const links = (stances: (string | null)[]) => stances.map((stance, i) => ({ kind: 'web', url: `https://e.org/s${i}`, date: today, ...(stance ? { stance } : {}) }));
		await discuss(a, links(['refutes', 'questions', 'reacts']));
		await discuss(b, links(['confirms', null]));
		const both = pair(a, b);
		for (const sort of ['score', 'day', 'week']) assert.equal((await search(db, both, { sort, limit: 1 })).results[0].id, b, sort);
		assert.deepEqual((await search(db, `${both} is:disputed`)).results.map((x) => x.id), [a]);
		assert.equal((await search(db, `${both} is:discussed`)).total, 2); // a refutation is still a response
		const rec = await get(db, a);
		assert.deepEqual([rec?.discussed, rec?.disputed, (await get(db, b))?.disputed], [3, true, false]);
		await db.query("UPDATE open_index.records SET record = record - 'discussion' WHERE id = ANY($1)", [[a, b]]); // leave the later rankings alone
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

	test('most cited in comments: the records comments name, by how many people, then the newest', async () => {
		const ids = async (o: { limit: number; cursor?: string | null; sort?: string }) => {
			const r = await search(db, 'source:palomar', { sort: 'mentions', ...o });
			return { ids: r.results.map((x) => String(x.id)), next: r.next_cursor };
		};
		const newest = (await ids({ sort: 'newest', limit: 13 })).ids;
		assert.deepEqual((await ids({ limit: 10 })).ids, newest.slice(0, 10), 'nothing cited yet: the newest');
		const [x, y, z] = newest.slice(5, 8);
		const host = String(items.find((it) => it.source === 'hexagon')!.id);
		await comment(db, host, { login: 'ivan', agent: 'Claude Code' }, { body: `Compare ${z} and ${x}.` });
		await comment(db, host, { login: 'judy', agent: 'Codex' }, { body: `See ${z} and ${y}.` });
		const expected = [z, x, y, ...newest.filter((id) => ![x, y, z].includes(id))]; // ties go to the newer
		const first = await ids({ limit: 5 });
		assert.deepEqual(first.ids, expected.slice(0, 5));
		assert.deepEqual((await ids({ limit: 5, cursor: first.next })).ids, expected.slice(5, 10));
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
		for (const [agent, fix] of [[undefined, /your name/], ['', /your name/], ['   ', /your name/], [42, /your name/], ['x'.repeat(61), /at most 60/]] as const) {
			await assert.rejects(startDevice(db, agent), (e: unknown) => e instanceof QueryError && fix.test(e.fix), String(agent));
		}
		await assert.rejects(createAgentKey(db, 'gina', 'y'.repeat(61)), /more than 60/);
		assert.equal((await pendingDevice(db, (await startDevice(db, `  ${'z'.repeat(60)}  `)).user_code))?.agent, 'z'.repeat(60));
		const denied = await startDevice(db, 'Grok bot');
		await denyDevice(db, denied.user_code);
		await assert.rejects(redeemDevice(db, denied.device_code), /denied/);
		await db.query("UPDATE open_index.agent_keys SET expires_at = now() - interval '1 day' WHERE login = 'gina'");
		assert.equal(await voterFromKey(db, got.key), null, 'keys expire');
	});

	test('top today, this week, this month: votes cast in that time', async () => {
		const [old, fresh] = items.filter((it) => it.source === 'palomar').slice(0, 2).map((it) => String(it.id));
		const erin = { login: 'erin', agent: '' }, finn = { login: 'finn', agent: '' };
		await vote(db, old, erin, { value: 1 });
		await vote(db, old, finn, { value: 1 });
		await db.query("UPDATE open_index.votes SET at = now() - interval '10 days' WHERE record_id = $1", [old]);
		await vote(db, fresh, erin, { value: 1 });
		const top = async (sort: string) => (await search(db, 'source:palomar', { sort, limit: 1 })).results[0].id;
		assert.deepEqual([await top('week'), await top('month'), await top('score')], [fresh, old, old]);
		assert.equal((await myVotes(db, 'erin', [old, fresh, 'nope/x'])).get(fresh)?.value, 1);
	});

	test('MCP at /mcp: initialize, list the tools, call each, over Streamable HTTP', async () => {
		const rpc = async (method: string, params: object = {}) => {
			const req = new Request('http://localhost/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
				headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } });
			const res = await mcp(req, async () => db);
			assert.equal(res.status, 200);
			return (await res.json()).result;
		};
		const call = async (name: string, args: object) => rpc('tools/call', { name, arguments: args });
		await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
		const tools = (await rpc('tools/list')).tools as { name: string; annotations: object; outputSchema?: object }[];
		// What each tool may do, and who may call it, is in lib/api/mcp-auth.test.ts.
		assert.deepEqual(tools.map((t) => t.name), ['search', 'get', 'log', 'post', 'edit', 'vote']);
		for (const t of tools) assert.ok(t.outputSchema, t.name);

		const total = async (q: string) => (await search(db, q, { limit: 1 })).total; // earlier tests link posts to some records
		const found = (await call('search', { q: 'is:discussed', sort: 'score', limit: 2 })).structuredContent;
		assert.equal(found.total, await total('is:discussed'));
		assert.ok(found.results.every((r: Record<string, unknown>) => r.page && !r.links && r.discussed));
		assert.ok(!('took_ms' in found));

		const it = items.find((x) => x.source === 'openai-math' && Array.isArray(x.discussion) && x.discussion.length > 2)!;
		const rec = (await call('get', { id: it.id })).structuredContent;
		assert.equal(rec.discussion.length, (it.discussion as unknown[]).length);
		assert.ok(rec.discussion.every((l: Record<string, unknown>) => l.url && l.quote && !('added' in l) && !('kind' in l)));
		assert.ok(Array.isArray(rec.discusses));

		// The records with the newest responses: a search like any other, sorted by response, each with that response.
		const list = (await call('search', { q: 'is:discussed', sort: 'responded', limit: 3 })).structuredContent;
		assert.equal(list.total, await total('is:discussed'));
		assert.ok(list.results.every((r: Record<string, unknown>) => r.latest_response));
		assert.equal((await call('search', { q: 'is:discussed source:openai-math', sort: 'responded', limit: 1 })).structuredContent.total,
			await total('is:discussed source:openai-math'));

		for (const [name, args, text] of [['get', { id: 'nope/x' }, /no record/], ['search', { q: 'foo:bar' }, /Use one of/],
			['search', { q: 'a) OR (b', sort: 'responded' }, /Balance/], ['search', { limit: 0 }, /limit/]] as const) {
			const r = await call(name, args);
			assert.ok(r.isError && text.test(r.content[0].text), name);
		}
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
