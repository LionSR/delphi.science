// Every route is documented, and each operation's real responses fit its schema (objects closed).
// Needs a build: python3 index.py build.
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { load, type Item } from '#lib/records/load.ts';
import { addMember, createSpace } from '#lib/posts/spaces.ts';
import { handle as mcp } from './mcp.ts';
import { spec } from './openapi.ts';
import { closed } from './schema.ts';
import { approveDevice } from '#lib/accounts/device.ts';
import { createAgentKey } from '#lib/accounts/keys.ts';
import { allowRouteImports, BUILD, migratedDb, sampleItems, useDb } from '#lib/testing.ts';

// Next's bundler resolves next/server for the routes; plain Node needs the file named.
allowRouteImports();

const API = new URL('../../app/api/v1/', import.meta.url);
const UNDOCUMENTED = ['/api/v1', '/api/v1/openapi.json']; // the API's own guides, not operations
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

type Op = { responses: Record<string, { content?: Record<string, { schema?: object }> }> };
const paths = spec.paths as Record<string, Record<string, Op>>;

// Every route.ts under app/api/v1, as the path the document names it by ([prefix] → {prefix}).
function routes(dir = API, at = '/api/v1'): [string, URL][] {
	return readdirSync(dir).flatMap((f) => {
		const u = new URL(f, dir);
		if (statSync(u).isDirectory()) return routes(new URL(`${f}/`, dir), `${at}/${f.replace(/^\[(?:\.\.\.)?(.+)\]$/, '{$1}')}`);
		return f === 'route.ts' ? [[at, u] as [string, URL]] : [];
	});
}

describe('the OpenAPI document', () => {
	test('documents every API route and method and nothing else, each served by operation() under its id and usage name from the document', async () => {
		const found = routes().filter(([p]) => !UNDOCUMENTED.includes(p));
		assert.deepEqual(found.map(([p]) => p).sort(), Object.keys(paths).sort());
		for (const [p, file] of found) {
			const mod = await import(file.href);
			assert.deepEqual(Object.keys(mod).filter((m) => METHODS.includes(m)).sort(), Object.keys(paths[p]).map((m) => m.toUpperCase()).sort(), p);
			assert.doesNotMatch(readFileSync(file, 'utf8'), /\bcounted\(/, `${p} counts itself instead of through operation()`);
			for (const [m, op] of Object.entries(paths[p] as unknown as Record<string, { operationId: string }>)) {
				const handler = mod[m.toUpperCase()] as { operationId?: string; endpoint?: string };
				assert.equal(handler.operationId, op.operationId, `${m} ${p}`);
				assert.equal(handler.endpoint, `${m.toUpperCase()} ${p}`, `${m} ${p}: counted under another name`);
			}
		}
	});

	test('fits what tool importers accept: unique operation ids, summaries under 300 characters, parameters under 700', () => {
		type Full = Op & { operationId: string; summary: string; parameters?: { name: string; description?: string }[] };
		const ops = Object.values(paths).flatMap((o) => Object.values(o) as Full[]);
		assert.equal(new Set(ops.map((o) => o.operationId)).size, ops.length);
		for (const o of ops) {
			assert.ok(o.summary.length < 300, `${o.operationId} summary: ${o.summary.length} characters`);
			for (const { name, description = '' } of o.parameters ?? []) assert.ok(description.length < 700, `${o.operationId} ${name}: ${description.length} characters`);
		}
	});

	test('its schemas compile', () => {
		const ajv = addFormats(new Ajv2020({ strict: false }));
		ajv.addSchema({ $id: 'spec', components: spec.components });
		for (const name of Object.keys(spec.components.schemas)) ajv.getSchema(`spec#/components/schemas/${name}`);
	});
});

describe('real responses fit it', { skip: !existsSync(BUILD) && 'build the index first' }, () => {
	let pg: PGlite;
	const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
	ajv.addSchema({ $id: 'spec', components: closed(spec.components) });
	const seen = new Set<string>();
	let key = '';
	let discussed = '', record = ''; // a record with several responses, and its path under /api/v1/records
	let moderationMode: 'accept' | 'reject' | 'review' | 'unavailable' = 'accept';
	const priorFetch = globalThis.fetch, priorEnv = { ORI_STATS_ADMINS: process.env.ORI_STATS_ADMINS, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY };
	after(() => {
		globalThis.fetch = priorFetch;
		for (const [name, value] of Object.entries(priorEnv)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
	});

	before(async () => {
		// Fake the moderation model's API.
		process.env.DEEPSEEK_API_KEY = 'offline-schema-fixture';
		globalThis.fetch = (async (url) => {
			assert.equal(String(url), 'https://api.deepseek.com/chat/completions', 'unexpected network call');
			if (moderationMode === 'unavailable') return new Response('private unavailable fixture', { status: 503 });
			return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(moderationMode === 'reject'
				? { decision: 'REQUEST_REVISION', verification_needed: false, reason: 'Private schema fixture needs a specific contribution.', fix: 'Provide the argument or narrow the claim.' }
				: moderationMode === 'review' ? { decision: 'REVIEW_NEEDED', verification_needed: true, reason: 'A source needs independent checking.', fix: 'Supply a verifiable source or independent argument.' }
				: { decision: 'ACCEPT', verification_needed: false, reason: 'Private schema fixture.', fix: '' }) } }] });
		}) as typeof fetch;
		pg = await migratedDb();
		const items = sampleItems();
		await load(pg, items);
		discussed = items.find((i) => (i.discussion as unknown[]).length > 2)!.id as string;
		const [prefix, suffix] = discussed.split('/');
		record = `/api/v1/records/${prefix}/${encodeURIComponent(suffix)}`;
		// A stance on each kind of link and a reviewed reception, so those fields are served and checked too.
		const rec = items.find((i) => i.id === discussed)!;
		const links = (rec.discussion as { url: string }[]).map((d, n) => ({ ...d, stance: n ? 'confirms' : 'questions' }));
		const reception = { text: 'Checked by two readers; one gap is open.', written: '2026-10-25', links: [links[0].url], reviewed_by: 'someone' };
		await pg.query("UPDATE open_index.records SET record = record || jsonb_build_object('discussion', $2::jsonb, 'reception', $3::jsonb) WHERE id = $1",
			[discussed, JSON.stringify(links), JSON.stringify(reception)]);
		useDb(pg); // what lib/db.ts hands every route
		key = await createAgentKey(pg, 'someone', 'Test agent');
		process.env.ORI_STATS_ADMINS = 'someone';
	});

	// Calls the route as Next does and checks the answer against the document's response for its status.
	async function call(method: string, path: string, opts: { query?: string; body?: unknown; auth?: boolean | string; params?: Record<string, string>; headers?: Record<string,string> } = {}) {
		// As Next routes: a static path (/keys/device) wins over a parameter (/keys/{hash}).
		// A verb's path id is a catch-all ([...id]): Next hands the route its segments, decoded.
		const verb = path.match(/^\/api\/v1\/(get|post|edit|vote)\/(.+)$/);
		const tmpl = verb ? `/api/v1/${verb[1]}/{id}` : Object.keys(paths).filter((p) => new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path))
			.sort((a, b) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0))[0]!;
		const file = routes().find(([p]) => p === tmpl)![1];
		const ids = tmpl.match(/\{([^}]+)\}/g)?.map((x) => x.slice(1, -1)) ?? [];
		const values = path.split('/').filter((_, n) => tmpl.split('/')[n]?.startsWith('{'));
		const params = Promise.resolve<Record<string, string | string[]>>(verb ? { id: verb[2].split('/').map(decodeURIComponent) } : Object.fromEntries(ids.map((k, n) => [k, values[n]])));
		const req = new Request(`http://test${path}${opts.query ? `?${opts.query}` : ''}`, {
			method, headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: `Bearer ${opts.auth === true ? key : opts.auth}` } : {}), ...opts.headers },
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		});
		const res: Response = await (await import(file.href))[method](req, { params });
		const doc = paths[tmpl][method.toLowerCase()].responses[String(res.status)];
		assert.ok(doc, `${method} ${path}: ${res.status} is not documented`);
		const type = (res.headers.get('content-type') ?? '').split(';')[0];
		const content = doc.content ?? {};
		assert.ok(type in content || (!Object.keys(content).length && type === 'text/plain'), `${method} ${path}: ${type} is not documented for ${res.status}`);
		const schema = content[type]?.schema;
		const text = await res.text();
		if (schema) {
			const validate = ajv.compile(closedRef(schema));
			const data = type === 'application/json' ? JSON.parse(text) : text;
			const problems = [...new Set((validate(data) ? [] : validate.errors!).map((e) =>
				`${e.instancePath.replace(/\/\d+/g, '[]') || '(body)'} ${e.params.additionalProperty ? `serves ${e.params.additionalProperty}, which is not documented` : e.message}`))];
			assert.deepEqual(problems, [], `${method} ${path} ${res.status}`);
		}
		seen.add(`${method.toLowerCase()} ${tmpl} ${res.status}`);
		return { status: res.status, text, headers: res.headers };
	}
	// A response schema, closed like the components, with its $refs pointed at the registered document.
	const closedRef = (s: object): object => JSON.parse(JSON.stringify(closed(s)).replaceAll('"#/components/', '"spec#/components/'));

	test('search, compact and full, as JSON and Markdown, and a bad query', async () => {
		await call('GET', '/api/v1/search', { query: 'q=is:discussed&limit=5' });
		await call('GET', '/api/v1/search', { query: `q=${encodeURIComponent(`id:${JSON.stringify(discussed)}`)}&fields=full` });
		await call('GET', '/api/v1/search', { query: 'sort=responded&limit=3&format=md' });
		const page = JSON.parse((await call('GET', '/api/v1/search', { query: 'limit=2' })).text);
		await call('GET', '/api/v1/search', { query: `limit=2&cursor=${page.next_cursor}` });
		assert.equal((await call('GET', '/api/v1/search', { query: 'q=foo:bar' })).status, 400);
	});

	test('records, with stances and a reception, and an unknown id', async () => {
		await call('GET', record);
		assert.equal((await call('GET', '/api/v1/records/nope/nothing')).status, 404);
	});

	test('comments and votes, read and written with an agent key', async () => {
		assert.equal((await call('POST', `${record}/comments`, { body: { body: 'A first reading.' } })).status, 401);
		const c = JSON.parse((await call('POST', `${record}/comments`, { body: { body: 'A first reading.', review: true }, auth: true })).text);
		await call('POST', `${record}/comments`, { body: { body: 'A reply.', parent: c.id }, auth: true });
		assert.equal((await call('POST', `${record}/comments`, { body: { body: '' }, auth: true })).status, 400);
		await call('GET', `${record}/comments`);
		await call('POST', `${record}/vote`, { body: { value: 1, emoji: '🤔', note: 'Worth checking.' }, auth: true });
		assert.equal((await call('POST', `${record}/vote`, { body: { value: 7 }, auth: true })).status, 400);
		await call('GET', `${record}/vote`);
		await call('DELETE', `${record}/vote`, { auth: true });
		assert.equal((await call('DELETE', `${record}/vote`)).status, 401);
		assert.equal((await call('POST', `${record}/vote`, { body: { value: 1 } })).status, 401);
		for (const [method, path, body] of [['POST', 'comments', { body: 'Hello.' }], ['POST', 'vote', { value: 1 }], ['DELETE', 'vote', undefined]] as const) {
			assert.equal((await call(method, `/api/v1/records/nope/nothing/${path}`, { body, auth: true })).status, 404, `${method} ${path}`);
		}
	});

	test('prefixes, usage stats and the agent-key device flow', async () => {
		await call('GET', '/api/v1/prefixes');
		const stats = await call('GET', '/api/v1/stats', { query: 'weeks=2', auth: true });
		assert.equal(stats.status, 200);
		assert.equal(stats.headers.get('cache-control'), 'private, no-store');
		assert.equal((await call('GET', '/api/v1/stats')).status, 401);
		const other = await createAgentKey(pg, 'not-an-admin', 'tool');
		const denied = await call('GET', '/api/v1/stats', { auth: other });
		assert.equal(denied.status, 403);
		assert.equal(denied.headers.get('cache-control'), 'private, no-store');
		process.env.ORI_STATS_ADMINS = '';
		assert.equal((await call('GET', '/api/v1/stats', { auth: true })).status, 403);
		process.env.ORI_STATS_ADMINS = 'someone';
		const d = JSON.parse((await call('POST', '/api/v1/keys/device', { body: { agent: 'Test agent' } })).text);
		assert.equal((await call('POST', '/api/v1/keys/device', { body: { agent: ' ' } })).status, 400);
		assert.equal((await call('POST', '/api/v1/keys/token', { body: { device_code: d.device_code } })).status, 400);
		await approveDevice(pg, d.user_code, 'someone'); // what the person does on /keys/approve
		assert.match((await call('POST', '/api/v1/keys/token', { body: { device_code: d.device_code } })).text, /oik_/);
	});

	test('a request the document does not allow is a 400 that says what to send', async () => {
		const error = async (method: string, path: string, opts: Parameters<typeof call>[2]) => {
			const r = await call(method, path, opts);
			assert.equal(r.status, 400, `${method} ${path} ${opts?.query ?? JSON.stringify(opts?.body)}`);
			return JSON.parse(r.text).error as { code: string; message: string; fix: string };
		};
		// Parameters: enums, ranges and types, read from the query string.
		assert.deepEqual(await error('GET', '/api/v1/search', { query: 'sort=hot' }), { code: 'bad_request', message: 'unknown sort "hot"',
			fix: 'Use sort=relevance, sort=newest, sort=oldest, sort=title, sort=score, sort=day, sort=week, sort=month, sort=mentions, sort=responded.' });
		assert.match((await error('GET', '/api/v1/search', { query: 'fields=all' })).fix, /^Use fields=compact \(default\), fields=full\.$/);
		assert.match((await error('GET', '/api/v1/search', { query: 'format=xml' })).message, /^unknown format "xml"$/);
		for (const limit of ['0', '101', 'abc', '2.5', '']) {
			assert.match((await error('GET', '/api/v1/search', { query: `limit=${limit}` })).fix, /^Send limit: an integer from 1 to 100 \(default 20\)\./, limit);
		}
		assert.match((await error('GET', '/api/v1/stats', { query: 'weeks=14', auth: true })).message, /^weeks must be from 1 to 13$/);
		await error('POST', '/api/v1/keys/token', { query: 'format=xml', body: { device_code: 'x' } });
		// Bodies: required fields, types, lengths, and one of several fields.
		assert.match((await error('POST', '/api/v1/keys/token', { body: {} })).message, /^the body needs "device_code"$/);
		assert.match((await error('POST', '/api/v1/keys/device', { body: { agent: 5 } })).message, /^"agent" must be a string$/);
		assert.equal((await error('POST', '/api/v1/keys/device', { body: ['Test agent'] })).code, 'bad_body');
		assert.match((await error('POST', `${record}/comments`, { body: { body: 'x'.repeat(4001) }, auth: true })).message, /^"body" is longer than 4000 characters$/);
		assert.match((await error('POST', `${record}/comments`, { body: { body: 'Hi.', review: 'yes' }, auth: true })).message, /^"review" must be a boolean$/);
		assert.deepEqual(await error('POST', `${record}/vote`, { body: { note: 'Why not.' }, auth: true }),
			{ code: 'bad_request', message: 'the body needs "value" or "emoji"', fix: 'Send value, emoji, or both.' });
		assert.match((await error('POST', `${record}/vote`, { body: { value: 1, note: 'x'.repeat(501) }, auth: true })).message, /^"note" is longer than 500 characters$/);
		// The domain's own checks still run after the document's checks.
		assert.match((await error('POST', '/api/v1/keys/device', { body: { agent: '   ' } })).message, /needs a name/);
		assert.match((await error('POST', `${record}/vote`, { body: { emoji: 'no' }, auth: true })).message, /one emoji/);
	});

	test('query strings are read as the declared types, with their defaults', async () => {
		assert.equal(JSON.parse((await call('GET', '/api/v1/search', { query: 'limit=3' })).text).count, 3);
		assert.equal(JSON.parse((await call('GET', '/api/v1/search')).text).count, 20);
		assert.equal(JSON.parse((await call('GET', '/api/v1/stats', { auth: true })).text).weeks, 8);
		assert.equal((await call('POST', `${record}/comments`, { body: { body: 'A reply to nothing.', parent: null }, auth: true })).status, 201);
	});

	test('/api/v1 and /llms.txt list the operations from the document', async () => {
		const ops = Object.entries(paths).flatMap(([p, o]) => Object.entries(o).map(([m, op]) => ({ name: `${m.toUpperCase()} ${p}`, id: (op as unknown as { operationId: string }).operationId })));
		const index = await (await (await import(new URL('route.ts', API).href)).GET(new Request('http://test/api/v1'))).json();
		assert.deepEqual(index.endpoints.map((e: { id: string }) => e.id), ops.map((o) => o.id));
		const llms = await (await (await import(new URL('../../llms.txt/route.ts', API).href)).GET(new Request('http://test/llms.txt'))).text();
		for (const { name } of ops) assert.ok(llms.includes(`${name}`), `llms.txt leaves out ${name}`);
	});

	test('submitting a link, and the forum: asking, answering, voting and accepting', async () => {
		const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry>
			<id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published><title>Attention Is All You Need</title>
			<summary>The dominant sequence transduction models.</summary><author><name>Ashish Vaswani</name></author>
			<arxiv:primary_category term="cs.CL"/><category term="cs.CL"/></entry></feed>`;
		const real = globalThis.fetch; // the source, faked: arXiv answers for this one paper
		globalThis.fetch = (async (url: string | URL | Request, init) =>
			String(url).includes('id_list=1706.03762') ? new Response(atom) : real(url, init)) as typeof fetch;
		try {
			assert.equal((await call('POST', '/api/v1/submit', { body: { url: 'arXiv:1706.03762' } })).status, 401);
			assert.equal((await call('POST', '/api/v1/submit', { body: { url: 'arXiv:1706.03762' }, auth: true })).status, 201);
			assert.equal((await call('POST', '/api/v1/submit', { body: { url: 'https://arxiv.org/abs/1706.03762' }, auth: true })).status, 200);
			assert.equal((await call('POST', '/api/v1/submit', { body: { url: 'two words' }, auth: true })).status, 400);
		} finally {
			globalThis.fetch = real;
		}

		const other = await createAgentKey(pg, 'another', 'Other agent');
		assert.equal((await call('POST', '/api/v1/forum', { body: { title: 'Q', body: 'B' } })).status, 401);
		assert.equal((await call('POST', '/api/v1/forum', { body: { title: '', body: 'B' }, auth: true })).status, 400);
		const t = JSON.parse((await call('POST', '/api/v1/forum', { body: { title: 'Who reran table 2?', body: `Has anyone checked ${discussed}?` }, auth: true })).text);
		const a = JSON.parse((await call('POST', `/api/v1/forum/${t.id}`, { body: { body: 'Yes: it holds to two digits.' }, auth: other })).text);
		await call('POST', `/api/v1/forum/${t.id}`, { body: { body: 'Which seed?', parent: a.id }, auth: true });
		assert.equal((await call('POST', `/api/v1/forum/${t.id}`, { body: { body: '' }, auth: true })).status, 400);
		assert.equal((await call('POST', `/api/v1/forum/${t.id}`, { body: { body: 'x' } })).status, 401);
		assert.equal((await call('POST', '/api/v1/forum/999999', { body: { body: 'An answer.' }, auth: true })).status, 404);

		await call('POST', `/api/v1/forum/${t.id}/vote`, { body: { post: a.id, value: 1 }, auth: true });
		assert.equal((await call('POST', `/api/v1/forum/${t.id}/vote`, { body: { post: a.id, value: 1 }, auth: other })).status, 400); // their own
		assert.equal((await call('POST', `/api/v1/forum/${t.id}/vote`, { body: { post: 999999, value: 1 }, auth: true })).status, 404);
		assert.equal((await call('POST', `/api/v1/forum/${t.id}/vote`, { body: { post: a.id, value: 1 } })).status, 401);
		assert.equal(JSON.parse((await call('POST', `/api/v1/forum/${t.id}/accept`, { body: { post: a.id }, auth: true })).text).accepted_id, a.id);
		assert.equal((await call('POST', `/api/v1/forum/${t.id}/accept`, { body: { post: a.id }, auth: other })).status, 400); // not the asker
		assert.equal((await call('POST', '/api/v1/forum/999999/accept', { body: { post: a.id }, auth: true })).status, 404);
		assert.equal((await call('POST', `/api/v1/forum/${t.id}/accept`, { body: { post: a.id } })).status, 401);

		await call('GET', `/api/v1/forum/${t.id}`);
		assert.equal((await call('GET', '/api/v1/forum/999999')).status, 404);
		await call('GET', '/api/v1/forum', { query: 'limit=1' });
		await call('GET', '/api/v1/forum', { query: 'q=table&since=0' });
		assert.equal((await call('GET', '/api/v1/forum', { query: 'cursor=%25%25' })).status, 400);
		// What the document allows, checked before the forum's own rules.
		const fix = async (method: string, path: string, opts: Parameters<typeof call>[2]) => JSON.parse((await call(method, path, opts)).text).error.message;
		assert.equal(await fix('POST', '/api/v1/forum', { body: { title: 'x'.repeat(201), body: 'B' }, auth: true }), '"title" is longer than 200 characters');
		assert.equal(await fix('POST', `/api/v1/forum/${t.id}/vote`, { body: { post: a.id, value: 2 }, auth: true }), '"value" must be 1, -1 or 0');
		assert.equal(await fix('GET', '/api/v1/forum', { query: 'limit=0' }), 'limit must be from 1 to 100');
		assert.equal(await fix('GET', '/api/v1/forum/abc', {}), 'id must be an integer');
		assert.equal(await fix('POST', '/api/v1/submit', { body: {}, auth: true }), 'the body needs "url"');
	});

	test('a person\'s activity, by tab and page, for agents as for /u/<login>', async () => {
		await call('POST', `${record}/vote`, { body: { value: 1, emoji: '🤔' }, auth: true });
		const all = JSON.parse((await call('GET', '/api/v1/users/Someone', { query: 'limit=1' })).text);
		assert.equal(all.login, 'someone');
		assert.equal(all.posts.length, 1);
		assert.ok(all.counts.topics >= 1 && all.counts.votes === 1, JSON.stringify(all.counts));
		const next = JSON.parse((await call('GET', '/api/v1/users/someone', { query: `limit=1&cursor=${all.next_cursor}` })).text);
		assert.ok(next.posts[0].id < all.posts[0].id);
		assert.ok(JSON.parse((await call('GET', '/api/v1/users/someone', { query: 'tab=topics' })).text).posts.every((p: { kind: string }) => p.kind === 'question'));
		const votes = JSON.parse((await call('GET', '/api/v1/users/someone', { query: 'tab=votes' })).text);
		assert.equal(votes.votes[0].record_id, discussed);
		assert.equal(votes.posts, undefined);
		assert.equal((await call('GET', '/api/v1/users/no--such', {})).status, 400);
		assert.equal((await call('GET', '/api/v1/users/someone', { query: 'tab=answers' })).status, 400);
		assert.equal((await call('GET', '/api/v1/users/someone', { query: 'cursor=forged' })).status, 400);
		useDb({ query: async () => { throw new Error('offline'); } });
		try {
			assert.equal((await call('GET', '/api/v1/users/someone', {})).status, 503);
		} finally {
			useDb(pg);
		}
	});

	test('posting feedback: every prose path documents revision, verification hold and service failure', async () => {
		const t = JSON.parse((await call('POST', '/api/v1/forum', { body: { title: 'Which endpoint convention is used?', body: 'For an open chain, which terms remain after telescoping?' }, auth: true })).text);
		const normalFetch = globalThis.fetch;
		globalThis.fetch = (async (url, init) => {
			if (String(url).includes('id_list=2601.99999')) return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2601.99999v1</id><published>2026-01-01</published><title>Finite-chain boundary computations</title><summary>A reproducible scoped computation.</summary><author><name>Offline Author</name></author></entry></feed>`);
			return normalFetch(url, init);
		}) as typeof fetch;
		try {
			for (const mode of ['reject', 'review', 'unavailable'] as const) {
				moderationMode = mode;
				for (const [path, body] of [
					[`${record}/comments`, { body: 'Which boundary conditions are assumed for the displayed calculation?' }],
					[`${record}/vote`, { value: 1, note: 'The endpoint terms depend on the boundary convention.' }],
					['/api/v1/submit', { url: 'arXiv:2601.99999' }],
					['/api/v1/forum', { title: 'How are the boundary terms normalized?', body: 'Which boundary conditions are assumed for the displayed calculation?' }],
					[`/api/v1/forum/${t.id}`, { body: 'Which boundary conditions are assumed for the displayed calculation?' }],
				] as const) {
					const r = await call('POST', path, { body, auth: true });
					assert.equal(r.status, mode === 'reject' ? 422 : mode === 'review' ? 409 : 503, path);
					const error = JSON.parse(r.text).error;
					assert.equal(error.code, mode === 'reject' ? 'moderation_rejected' : mode === 'review' ? 'moderation_review_needed' : 'moderation_unavailable');
					assert.ok(error.message && error.fix);
				}
			}
		} finally { moderationMode = 'accept'; globalThis.fetch = normalFetch; }
	});

	test('public source checks document auth, same-origin, strict URL bodies and unavailable audit storage', async () => {
		const at = `${record}/source-checks`, urls = ['https://example.org/source'], elsewhere = { Origin: 'https://another.example.org' };
		assert.equal((await call('POST', at, { body: { urls } })).status, 401);
		assert.equal((await call('POST', at, { auth: true, body: { urls: [] } })).status, 400);
		assert.equal((await call('POST', '/api/v1/records/nope/nothing/source-checks', { auth: true, body: { urls } })).status, 404);
		assert.equal((await call('POST', at, { auth: true, body: { urls } })).status, 200);
		assert.equal((await call('POST', at, { auth: true, headers: elsewhere, body: { urls } })).status, 403);
		assert.equal((await call('POST', `${record}/comments`, { auth: true, headers: elsewhere, body: { body: 'Which boundary convention is used?', retrieve_sources: true } })).status, 403);
		assert.equal((await call('POST', `${record}/vote`, { auth: true, headers: elsewhere, body: { value: 1, note: 'Which boundary convention is used?', retrieve_sources: true } })).status, 403);
		// A database without transactions cannot keep the audit trail.
		useDb({ query: pg.query.bind(pg) });
		try {
			assert.equal((await call('POST', at, { auth: true, body: { urls } })).status, 503);
		} finally {
			useDb(pg);
		}
	});

	test('post editing responses preserve the original through refusal and conflicts', async () => {
		const at = `${record}/comments`;
		const made = JSON.parse((await call('POST', at, { auth: true, body: { body: 'The finite chain retains its endpoint terms.' } })).text);
		const p = JSON.parse((await call('GET', at)).text).find((p: { id: number }) => p.id === made.id);
		const path = `/api/v1/posts/${p.id}`, body = { body: 'The corrected chain has periodic boundaries.', revision: p.revision };
		assert.equal((await call('PATCH', path, { body })).status, 401);
		assert.equal((await call('PATCH', path, { auth: true, body: { ...body, human: true } })).status, 400);
		const other = await createAgentKey(pg, 'another-editor', 'Test agent');
		assert.equal((await call('PATCH', path, { auth: other, body })).status, 403);
		assert.equal((await call('PATCH', '/api/v1/posts/99999999', { auth: true, body })).status, 404);
		assert.equal((await call('PATCH', path, { auth: true, body: { ...body, revision: '0' } })).status, 409);
		try {
			for (const mode of ['reject', 'review', 'unavailable'] as const) {
				moderationMode = mode;
				assert.equal((await call('PATCH', path, { auth: true, body })).status, mode === 'reject' ? 422 : mode === 'review' ? 409 : 503);
				assert.equal((await pg.query<{ body: string }>('SELECT body FROM open_index.comments WHERE id=$1', [p.id])).rows[0].body, p.body);
			}
		} finally { moderationMode = 'accept'; }
		const updated = JSON.parse((await call('PATCH', path, { auth: true, body })).text);
		assert.equal(updated.body, body.body); assert.notEqual(updated.revision, body.revision);
	});

	test('an agent reads and sets its person\'s name and affiliation, and lists and revokes keys', async () => {
		assert.equal((await call('GET', '/api/v1/profile')).status, 401);
		assert.equal((await call('PATCH', '/api/v1/profile', { body: { name: 'X' } })).status, 401);
		assert.equal((await call('PATCH', '/api/v1/profile', { body: { name: 'x'.repeat(101) }, auth: true })).status, 400);
		const saved = JSON.parse((await call('PATCH', '/api/v1/profile', { body: { name: 'Some One', affiliation: 'UCSD' }, auth: true })).text);
		assert.deepEqual(saved, { login: 'someone', name: 'Some One', affiliation: 'UCSD', edited: true });
		assert.equal(JSON.parse((await call('GET', '/api/v1/profile', { auth: true })).text).affiliation, 'UCSD');
		assert.equal(JSON.parse((await call('GET', '/api/v1/users/someone', {})).text).name, 'Some One');

		const spare = await createAgentKey(pg, 'someone', 'Spare agent');
		assert.equal((await call('GET', '/api/v1/keys')).status, 401);
		const keys = JSON.parse((await call('GET', '/api/v1/keys', { auth: true })).text).keys as { hash: string; agent: string; current: boolean }[];
		assert.equal(keys.find((k) => k.current)?.agent, 'Test agent');
		const hash = keys.find((k) => k.agent === 'Spare agent')!.hash;
		assert.equal((await call('DELETE', `/api/v1/keys/${hash}`)).status, 401);
		assert.equal((await call('DELETE', '/api/v1/keys/short', { auth: true })).status, 400);
		assert.equal((await call('DELETE', `/api/v1/keys/${'0'.repeat(64)}`, { auth: true })).status, 404);
		assert.equal((await call('DELETE', `/api/v1/keys/${hash}`, { auth: true })).status, 200);
		assert.equal((await call('GET', '/api/v1/keys', { auth: spare })).status, 401);
	});

	// ---- The six verbs over paths: each operation on each kind of path, and the same answers as the MCP tools ----

	const json = async (method: string, path: string, opts: Parameters<typeof call>[2] = {}) => {
		const r = await call(method, path, opts);
		return { status: r.status, ...JSON.parse(r.text) };
	};
	/** The MCP tool of the same name, called with the same arguments: its structured result, or the text of its refusal. */
	const tool = async (name: string, args: object, auth?: string) => {
		const res = await mcp(new Request('http://test/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
			headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) } }), async () => pg);
		const { result } = await res.json();
		return result.isError ? { refused: result.content[0].text as string } : { ...result.structuredContent, text: result.content[0].text as string };
	};
	/** A REST reply and a tool result are the same thing. */
	const same = (rest: Record<string, unknown>, fromTool: Record<string, unknown>, what: string) => {
		// json() adds the HTTP status (a number); a reply's own status (listed) stays.
		const { text: _text, ...b } = fromTool, a = Object.fromEntries(Object.entries(rest).filter(([k, v]) => k !== 'status' || typeof v !== 'number'));
		assert.deepEqual(a, b, what);
	};
	const enc = (id: string) => id.split('/').map(encodeURIComponent).join('/');
	// Their own author: a person's 30 posts a day are shared with the tests above.
	let topic = '', answer = '', comment = '', author = '';

	test('verbs: post makes a comment, a review, a reply, a topic and an answer, each returned with its path', async () => {
		author = await createAgentKey(pg, 'verb-author', 'Test agent');
		const c = await json('POST', `/api/v1/post/${enc(discussed)}`, { auth: author, body: { body: 'The second lemma needs the boundary term.' } });
		assert.equal(c.status, 201);
		assert.match(c.id, new RegExp(`^${discussed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\d+$`));
		comment = c.id;
		const review = await json('POST', `/api/v1/post/${enc(discussed)}`, { auth: author, body: { body: 'Checked sections 2 and 3 line by line.', review: true } });
		assert.equal(review.review, true);
		const reply = await json('POST', `/api/v1/post/${enc(comment)}`, { auth: author, body: { body: 'It does: see equation 4.' } });
		assert.equal(reply.parent, comment);
		const other = await createAgentKey(pg, 'verb-other', 'Other agent');
		const t = await json('POST', '/api/v1/post/forum', { auth: author, body: { title: 'Which seed reproduces table 3?', body: `Has anyone rerun ${discussed}?` } });
		assert.equal(t.status, 201);
		assert.match(t.id, /^forum\/\d+$/);
		topic = t.id;
		const a = await json('POST', `/api/v1/post/${topic}`, { auth: other, body: { body: 'Seed 7 does, to three digits.' } });
		assert.match(a.id, new RegExp(`^${topic}/\\d+$`));
		answer = a.id;
		assert.equal((await json('POST', `/api/v1/post/${answer}`, { auth: author, body: { body: 'On which hardware?' } })).parent, answer);
	});

	test('verbs: post refuses what the path does not take, a caller without a key, and a path that names nothing', async () => {
		const at = `/api/v1/post/${enc(discussed)}`, body = { body: 'A reading.' };
		assert.equal((await call('POST', at, { body })).status, 401);
		assert.equal((await call('POST', at, { auth: 'oik_unknown', body })).status, 401);
		assert.deepEqual((await json('POST', at, { auth: author, body: { ...body, title: 'T' } })).error,
			{ code: 'bad_request', message: `title does not apply to ${JSON.stringify(discussed)}`, fix: 'Leave title out; it is for a new topic (id forum, or a space) or a new space (id ws).' });
		assert.equal((await json('POST', at, { auth: author, body: {} })).error.message, 'the body needs "body"');
		assert.equal((await json('POST', '/api/v1/post/forum', { auth: author, body })).error.message, 'a new topic needs a title');
		assert.equal((await call('POST', '/api/v1/post/me', { auth: author, body })).status, 400);
		assert.equal((await call('POST', '/api/v1/post/app/no-such-record', { auth: author, body })).status, 404);
		assert.equal((await call('POST', '/api/v1/post/forum/999999', { auth: author, body })).status, 404);
		assert.equal((await call('POST', at, { auth: author, headers: { Origin: 'https://another.example.org' }, body: { ...body, retrieve_sources: true } })).status, 403);
	});

	test('verbs: post at records adds a link, and says so when it is already listed', async () => {
		const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry>
			<id>http://arxiv.org/abs/1810.04805v2</id><published>2018-10-11T00:50:01Z</published><title>BERT: Pre-training of Deep Bidirectional Transformers</title>
			<summary>We introduce a new language representation model.</summary><author><name>Jacob Devlin</name></author>
			<arxiv:primary_category term="cs.CL"/><category term="cs.CL"/></entry></feed>`;
		const real = globalThis.fetch;
		globalThis.fetch = (async (url: string | URL | Request, init) => String(url).includes('id_list=1810.04805') ? new Response(atom) : real(url, init)) as typeof fetch;
		try {
			const made = await call('POST', '/api/v1/post/records', { auth: author, body: { body: 'arXiv:1810.04805' } });
			assert.deepEqual([made.status, JSON.parse(made.text).status, JSON.parse(made.text).id], [201, 'listed', 'arxiv/1810.04805']);
			const again = await call('POST', '/api/v1/post/records', { auth: author, body: { body: 'https://arxiv.org/abs/1810.04805' } });
			assert.equal(again.status, 200);
			same(JSON.parse(again.text), await tool('post', { id: 'records', body: 'https://arxiv.org/abs/1810.04805' }, author), 'a link already listed');
		} finally { globalThis.fetch = real; }
	});

	test('verbs: get serves a record, a topic, a post and the account, as the tool does', async () => {
		for (const id of [discussed, topic, answer, comment]) {
			const got = await json('GET', `/api/v1/get/${enc(id)}`);
			assert.deepEqual([got.status, got.id], [200, id]);
			same(got, await tool('get', { id }), id);
		}
		// A slash sent encoded reaches the same record.
		assert.equal((await json('GET', `/api/v1/get/${encodeURIComponent(discussed)}`)).id, discussed);
		const me = await call('GET', '/api/v1/get/me', { auth: author });
		assert.equal(me.headers.get('cache-control'), 'private, no-store');
		same(JSON.parse(me.text), await tool('get', { id: 'me' }, author), 'me');
		assert.equal(JSON.parse(me.text).login, 'verb-author');
		assert.deepEqual((await json('GET', '/api/v1/get/me')).error.code, 'sign_in');
		assert.equal((await call('GET', '/api/v1/get/me')).status, 401);
		// A key that does not work is refused even where none is needed, as /mcp refuses it.
		assert.equal((await call('GET', `/api/v1/get/${enc(discussed)}`, { auth: 'oik_unknown' })).status, 401);
		for (const [id, status] of [['forum', 400], ['records', 400], ['arxiv', 400], ['app/no-such-record', 404], ['forum/999999', 404], ['forum/x', 404], [`${discussed}/999999`, 404], [`${topic}/999999`, 404]] as const) {
			const r = await json('GET', `/api/v1/get/${enc(id)}`);
			assert.equal(r.status, status, id);
			const refused = (await tool('get', { id })).refused;
			assert.equal(refused, `${r.error.message}. ${r.error.fix}`, id);
		}
		assert.equal((await json('GET', `/api/v1/get/${'x'.repeat(321)}`)).error.message, 'id is longer than 320 characters');
	});

	test('verbs: log lists every post, or those of a record, a source, the forum or a topic, as JSON and as lines', async () => {
		const source = discussed.split('/')[0];
		for (const path of [undefined, discussed, source, 'forum', topic]) {
			const query = path === undefined ? '' : `path=${encodeURIComponent(path)}`;
			const page = await json('GET', '/api/v1/log', { query });
			assert.equal(page.status, 200, path ?? 'everything');
			assert.ok(page.entries.length, path ?? 'everything');
			const fromTool = await tool('log', path === undefined ? {} : { path });
			same(page, fromTool, path ?? 'everything');
			// format=text is the tool's text, one line per post, ending in a newline.
			const text = await call('GET', '/api/v1/log', { query: `${query}&format=text` });
			assert.equal(text.headers.get('content-type'), 'text/plain; charset=utf-8');
			assert.equal(text.text, `${fromTool.text}\n`, path ?? 'everything');
			assert.deepEqual(text.text.trimEnd().split('\n').map((l) => Number(l.split('\t')[0])), page.entries.map((e: { seq: number }) => e.seq));
		}
		// Newest first; with since, the posts after it, oldest first; nothing newer is nothing at all.
		const all = await json('GET', '/api/v1/log');
		const seqs = all.entries.map((e: { seq: number }) => e.seq);
		assert.deepEqual(seqs, [...seqs].sort((a, b) => b - a));
		assert.equal(all.since, seqs[0]);
		const after = await json('GET', '/api/v1/log', { query: `since=${seqs.at(-1)}&limit=2` });
		assert.deepEqual(after.entries.map((e: { seq: number }) => e.seq), seqs.slice(-3, -1).reverse());
		assert.deepEqual(await json('GET', '/api/v1/log', { query: `since=${all.since}` }), { status: 200, path: '', since: all.since, entries: [] });
		assert.equal((await call('GET', '/api/v1/log', { query: `since=${all.since}&format=text` })).text, '');
		const line = (await call('GET', '/api/v1/log', { query: `path=${topic}&format=text` })).text.split('\n').find((l) => l.split('\t')[2] === answer)!.split('\t');
		assert.deepEqual([line.length, line[1], line[3], line[4], line[6], line[7], line[8], line[9]], [10, 'answer', '-', 'Other agent · @verb-other', '0', 'Which seed reproduces table 3?', 'Seed 7 does, to three digits.', '-']);
		// A record's line has no author; the opening post names the record, in the last column.
		const lines = (await call('GET', '/api/v1/log', { query: 'limit=200&format=text' })).text.trimEnd().split('\n').map((l) => l.split('\t'));
		assert.deepEqual(lines.find((l) => l[1] === 'record')!.slice(3, 5), ['-', '-']);
		assert.equal(lines.find((l) => l[1] === 'question' && l[2].startsWith(`${topic}/`))![9], discussed);
		for (const [query, status] of [['path=me', 400], ['path=records', 400], [`path=${encodeURIComponent(answer)}`, 400], ['limit=0', 400], ['since=-1', 400], ['format=tsv', 400], ['path=nowhere', 404], ['path=app/no-such-record', 404]] as const) {
			assert.equal((await call('GET', '/api/v1/log', { query })).status, status, query);
		}
	});

	test('verbs: log takes a query, the same by REST, by the tool and as a feed; to:@me is the caller\'s inbox', async () => {
		const source = discussed.split('/')[0];
		const paths = (page: { entries: { path: string }[] }) => page.entries.map((e) => e.path);
		for (const [q, path] of [['kind:record', source], [`re:${discussed}`, undefined], ['to:@verb-author', undefined], ['by:@Verb-Other', 'forum'], ['kind:answer OR kind:question', undefined],
			[`source:${source} NOT kind:record`, undefined], ['seed', 'forum'], ['kind:review', discussed]] as const) {
			const query = `q=${encodeURIComponent(q)}${path ? `&path=${encodeURIComponent(path)}` : ''}`;
			const page = await json('GET', '/api/v1/log', { query });
			assert.equal(page.status, 200, q);
			assert.ok(page.entries.length, q);
			const fromTool = await tool('log', { q, ...(path ? { path } : {}) });
			same(page, fromTool, q);
			assert.equal((await call('GET', '/api/v1/log', { query: `${query}&format=text` })).text, `${fromTool.text}\n`, q);
			// The feed: the same entries in the same order, each once, read as nobody.
			const feed = await call('GET', '/api/v1/log', { query: `${query}&format=atom`, auth: author });
			assert.equal(feed.headers.get('content-type'), 'application/atom+xml; charset=utf-8');
			assert.deepEqual([...feed.text.matchAll(/<entry>\n<id>[^<]*#(-?\d+)<\/id>/g)].map((m) => Number(m[1])), page.entries.map((e: { seq: number }) => e.seq), q);
		}
		// The inbox: what others posted to the caller. It needs the caller, by every door.
		const inbox = await json('GET', '/api/v1/log', { query: 'q=to:@me', auth: author });
		assert.deepEqual(paths(inbox), [answer]);
		same(inbox, await tool('log', { q: 'to:@me' }, author), 'to:@me');
		assert.deepEqual(paths(await json('GET', '/api/v1/log', { query: 'q=to:@verb-author' })), [answer], 'named, it is public');
		const anonymous = await json('GET', '/api/v1/log', { query: 'q=to:@me' });
		assert.deepEqual([anonymous.status, anonymous.error.code], [401, 'sign_in']);
		assert.match((await tool('log', { q: 'to:@me' })).refused!, /^Sign-in required/);
		assert.equal((await call('GET', '/api/v1/log', { query: 'q=to:@me&format=atom', auth: author })).status, 401, 'a feed is read as nobody');
		for (const q of ['kind:paper', 'foo:bar', 'to:', '(kind:record']) assert.equal((await call('GET', '/api/v1/log', { query: `q=${encodeURIComponent(q)}` })).status, 400, q);
	});

	test('verbs: search finds records and forum topics, as the tool does', async () => {
		for (const args of [{ q: 'is:discussed', limit: 5 }, { q: `id:${JSON.stringify(discussed)}`, fields: 'full' }, { sort: 'responded', limit: 3 }, { in: 'forum' }, { in: 'forum', q: 'seed' }] as Record<string, string | number>[]) {
			const found = await json('GET', '/api/v1/find', { query: new URLSearchParams(Object.entries(args).map(([k, v]) => [k, String(v)])).toString() });
			assert.equal(found.status, 200, JSON.stringify(args));
			same(found, await tool('search', args), JSON.stringify(args));
		}
		assert.deepEqual(JSON.parse((await call('GET', '/api/v1/find', { query: 'in=forum&q=reproduces' })).text).results.map((r: { id: string }) => r.id), [topic]);
		assert.equal((await json('GET', '/api/v1/find', { query: 'in=forum&sort=newest' })).error.message, 'sort and fields apply to records, not the forum');
		assert.equal((await call('GET', '/api/v1/find', { query: 'in=everywhere' })).status, 400);
		assert.equal((await call('GET', '/api/v1/find', { query: 'q=foo:bar' })).status, 400);
		assert.equal((await call('GET', '/api/v1/find', { auth: `oik_${'0'.repeat(48)}` })).status, 401);
	});

	test('verbs: edit replaces a post\'s text by its path, for its author only, and keeps it through refusals', async () => {
		const p = await json('GET', `/api/v1/get/${enc(comment)}`);
		const at = `/api/v1/edit/${enc(comment)}`, body = { body: 'The second lemma needs the boundary term of equation 4.', revision: p.revision };
		assert.equal((await call('PATCH', at, { body })).status, 401);
		assert.equal((await call('PATCH', at, { auth: await createAgentKey(pg, 'verb-stranger', 'Test agent'), body })).status, 403);
		assert.equal((await call('PATCH', at, { auth: author, body: { ...body, revision: '0' } })).status, 409);
		assert.equal((await json('PATCH', at, { auth: author, body: { body: body.body } })).error.message, 'the body needs "revision"');
		assert.equal((await json('PATCH', `/api/v1/edit/${enc(discussed)}`, { auth: author, body })).error.message, `${JSON.stringify(discussed)} is not a post`);
		assert.equal((await call('PATCH', `/api/v1/edit/${enc(discussed)}/999999`, { auth: author, body })).status, 404);
		// A post's number under another thread's path is not that post.
		assert.equal((await call('PATCH', `/api/v1/edit/${topic}/${comment.split('/').at(-1)}`, { auth: author, body })).status, 404);
		try {
			for (const mode of ['reject', 'review', 'unavailable'] as const) {
				moderationMode = mode;
				assert.equal((await call('PATCH', at, { auth: author, body })).status, mode === 'reject' ? 422 : mode === 'review' ? 409 : 503);
			}
		} finally { moderationMode = 'accept'; }
		assert.equal((await json('GET', `/api/v1/get/${enc(comment)}`)).body, p.body);
		const saved = await json('PATCH', at, { auth: author, body });
		assert.deepEqual([saved.status, saved.id, saved.body], [200, comment, body.body]);
		assert.notEqual(saved.revision, p.revision);
		// The same text again changes nothing, by either door.
		same(await json('PATCH', at, { auth: author, body: { body: body.body, revision: saved.revision } }), await tool('edit', { id: comment, body: body.body, revision: saved.revision }, author), 'an identical retry');
	});

	test('verbs: vote on a record, a topic and a forum post, take it back, and accept an answer', async () => {
		const on = `/api/v1/vote/${enc(discussed)}`;
		const up = await json('POST', on, { auth: author, body: { value: 1, emoji: '🤔' } });
		assert.deepEqual([up.status, up.id], [200, discussed]);
		same(await json('POST', on, { auth: author, body: { value: 1, emoji: '🤔' } }), await tool('vote', { id: discussed, value: 1, emoji: '🤔' }, author), 'the same vote again');
		assert.equal((await json('POST', on, { auth: author, body: { value: -1, if_absent: true } })).created, false);
		assert.equal((await json('POST', on, { auth: author, body: { value: 0 } })).status, 200);
		assert.deepEqual(await json('POST', `/api/v1/vote/${answer}`, { auth: author, body: { value: 1 } }), { status: 200, id: answer, score: 1 });
		const other = await createAgentKey(pg, 'verb-other', 'Other agent');
		const opening = (await json('GET', `/api/v1/get/${topic}`)).question.id;
		assert.deepEqual(await json('POST', `/api/v1/vote/${topic}`, { auth: other, body: { value: 1 } }), { status: 200, id: opening, score: 1 });
		assert.deepEqual(await json('POST', `/api/v1/vote/${answer}`, { auth: author, body: { accept: true } }), { status: 200, id: answer, accepted: answer });
		assert.deepEqual(await json('POST', `/api/v1/vote/${answer}`, { auth: author, body: { accept: true } }), { status: 200, id: answer, accepted: null });

		assert.equal((await call('POST', on, { body: { value: 1 } })).status, 401);
		for (const [path, body, message] of [
			[answer, {}, /^the vote is empty$/], [answer, { value: 2 }, /^"value" must be 1, -1 or 0$/], [answer, { value: 1, emoji: '🤔' }, /^emoji does not apply/],
			[comment, { value: 1 }, /^comments on records are not voted on$/], ['forum', { value: 1 }, /cannot be voted on$/], [discussed, { accept: true }, /^accept does not apply/],
		] as const) {
			const r = await json('POST', `/api/v1/vote/${enc(path)}`, { auth: author, body });
			assert.equal(r.status, 400, path);
			assert.match(r.error.message, message);
		}
		assert.equal((await call('POST', '/api/v1/vote/app/no-such-record', { auth: author, body: { value: 1 } })).status, 404);
		assert.equal((await call('POST', on, { auth: author, headers: { Origin: 'https://another.example.org' }, body: { value: 1, note: 'Which convention?', retrieve_sources: true } })).status, 403);
	});

	test('verbs: post and vote pass on moderation\'s revision, hold and failure, and nothing is stored', async () => {
		const before = (await json('GET', '/api/v1/log')).since;
		author = await createAgentKey(pg, 'verb-refused', 'Test agent');
		try {
			for (const mode of ['reject', 'review', 'unavailable'] as const) {
				moderationMode = mode;
				for (const [path, body] of [
					[`/api/v1/post/${enc(discussed)}`, { body: 'Which boundary conditions are assumed for the displayed calculation?' }],
					[`/api/v1/post/${topic}`, { body: 'Which boundary conditions are assumed for the displayed calculation?' }],
					['/api/v1/post/forum', { title: 'How are the boundary terms normalized?', body: 'Which boundary conditions are assumed for the displayed calculation?' }],
					[`/api/v1/vote/${enc(discussed)}`, { value: 1, note: 'The endpoint terms depend on the boundary convention.' }],
				] as const) {
					const r = await json('POST', path, { body, auth: author });
					assert.equal(r.status, mode === 'reject' ? 422 : mode === 'review' ? 409 : 503, path);
					assert.equal(r.error.code, mode === 'reject' ? 'moderation_rejected' : mode === 'review' ? 'moderation_review_needed' : 'moderation_unavailable');
					assert.ok(r.error.message && r.error.fix);
				}
			}
		} finally { moderationMode = 'accept'; }
		assert.equal((await json('GET', '/api/v1/log')).since, before);
	});

	test('spaces: deletion and member removal responses preserve creator permissions and private schemas', async () => {
		const owner = { login: 'schema-owner', agent: 'Test agent' }, member = { login: 'schema-member', agent: 'Test agent' };
		const ownerKey = await createAgentKey(pg, owner.login, owner.agent), memberKey = await createAgentKey(pg, member.login, member.agent);
		const space = await createSpace(pg, owner, { title: 'Schema boundary checks' });
		await addMember(pg, space.id, owner, member.login);
		await addMember(pg, space.id, member, member.login);
		const at = `/api/v1/ws/${space.id}`, membership = `${at}/members/${member.login}`;
		for (const path of [at, membership]) assert.equal((await call('DELETE', path)).status, 401);
		for (const path of ['/api/v1/ws/no-schema-space', '/api/v1/ws/no-schema-space/members/schema-member']) {
			assert.equal((await call('DELETE', path, { auth: ownerKey })).status, 404);
		}
		assert.equal((await call('DELETE', at, { auth: memberKey })).status, 400, 'a member cannot delete the space');
		assert.equal((await call('DELETE', `${at}/members/${owner.login}`, { auth: memberKey })).status, 400, 'a member cannot remove someone else');
		const removed = await call('DELETE', membership, { auth: ownerKey });
		assert.deepEqual([removed.status, JSON.parse(removed.text)], [200, { removed: `ws/${space.id}/members/${member.login}` }]);
		assert.equal(removed.headers.get('cache-control'), 'private, no-store');
		const deleted = await call('DELETE', at, { auth: ownerKey });
		assert.deepEqual([deleted.status, JSON.parse(deleted.text)], [200, { deleted: `ws/${space.id}` }]);
		assert.equal(deleted.headers.get('cache-control'), 'private, no-store');
	});

	test('verbs: the document says who must sign in, and the tools say the same', async () => {
		const { operationById, VERBS } = await import('./openapi.ts');
		const { TOOLS, securitySchemes } = await import('./mcp.ts');
		const { authorizationServer } = await import('#lib/accounts/oauth.ts');
		assert.deepEqual(Object.keys(TOOLS), [...VERBS]);
		assert.deepEqual(VERBS.map((v) => operationById(v).auth), ['optional', 'optional', 'optional', 'required', 'required', 'required']);
		for (const v of VERBS) assert.equal(TOOLS[v].auth, operationById(v).auth, v);
		assert.deepEqual(securitySchemes('get'), [{ type: 'noauth' }, { type: 'oauth2', scopes: ['write'] }]);
		// The OAuth scheme names the endpoints the authorization server's own metadata names.
		const { oauth, agentKey } = spec.components.securitySchemes, as = authorizationServer();
		assert.deepEqual([oauth.flows.authorizationCode.authorizationUrl, oauth.flows.authorizationCode.tokenUrl, Object.keys(oauth.flows.authorizationCode.scopes)],
			[as.authorization_endpoint, as.token_endpoint, as.scopes_supported]);
		assert.deepEqual([agentKey['x-device-authorization'].request, agentKey['x-device-authorization'].redeem].map((id) => operationById(id).path), ['/api/v1/keys/device', '/api/v1/keys/token']);
		// A token from OAuth sign-in is an agent key, so REST takes it as it takes a device-approved one.
		const deprecated = Object.values(paths).flatMap((o) => Object.values(o) as unknown as { operationId: string; deprecated?: boolean }[]).filter((o) => o.deprecated).map((o) => o.operationId);
		assert.deepEqual(deprecated.sort(), ['acceptAnswer', 'answerQuestion', 'askQuestion', 'editPost', 'getRecord', 'getTopic', 'listComments', 'listForum', 'postComment', 'removeVote', 'searchRecords', 'submitLink', 'votePost', 'voteRecord']);
	});

	test('every documented response was checked', () => {
		const documented = Object.entries(paths).flatMap(([p, ops]) => Object.entries(ops).flatMap(([m, op]) => Object.keys(op.responses).map((s) => `${m} ${p} ${s}`)));
		assert.deepEqual(documented.filter((d) => !seen.has(d)), []);
	});
});
