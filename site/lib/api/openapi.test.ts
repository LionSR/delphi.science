// Every route is documented, and each operation's real responses fit its schema (objects closed).
// Needs a build: python3 index.py build.
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { load, type Item } from '#lib/records/load.ts';
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
		if (statSync(u).isDirectory()) return routes(new URL(`${f}/`, dir), `${at}/${f.replace(/^\[(.+)\]$/, '{$1}')}`);
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
		const tmpl = Object.keys(paths).filter((p) => new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path))
			.sort((a, b) => (a.match(/\{/g)?.length ?? 0) - (b.match(/\{/g)?.length ?? 0))[0]!;
		const file = routes().find(([p]) => p === tmpl)![1];
		const ids = tmpl.match(/\{([^}]+)\}/g)?.map((x) => x.slice(1, -1)) ?? [];
		const values = path.split('/').filter((_, n) => tmpl.split('/')[n]?.startsWith('{'));
		const params = Promise.resolve(Object.fromEntries(ids.map((k, n) => [k, values[n]])));
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
		// The domain's own checks still answer after the document's.
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

	test('every documented response was checked', () => {
		const documented = Object.entries(paths).flatMap(([p, ops]) => Object.entries(ops).flatMap(([m, op]) => Object.keys(op.responses).map((s) => `${m} ${p} ${s}`)));
		assert.deepEqual(documented.filter((d) => !seen.has(d)), []);
	});
});
