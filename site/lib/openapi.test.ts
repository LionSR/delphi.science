// The OpenAPI document against the API itself: every route is documented with its methods, and what each
// operation really answers (status, content type, body) fits the document's schema for it. Objects are checked
// closed, so a field the API serves but the document leaves out fails too. Needs a build: python3 index.py build.
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { load, type Item } from './load.ts';
import { spec } from './openapi.ts';
import { approveDevice } from './device.ts';
import { createAgentKey } from './votes.ts';

// Next's bundler resolves next/server for the routes; plain Node needs the file named.
registerHooks({ resolve: (name, ctx, next) => next(name === 'next/server' ? 'next/server.js' : name, ctx) });

const API = new URL('../app/api/v1/', import.meta.url);
const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const INDEX = new URL('../../dist/index.json', import.meta.url);
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

// A copy of a schema with every object that lists its properties closed to others, so an undocumented field fails.
function closed(s: unknown): unknown {
	if (Array.isArray(s)) return s.map(closed);
	if (!s || typeof s !== 'object') return s;
	const o = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'properties' ? Object.fromEntries(Object.entries(v as object).map(([p, q]) => [p, closed(q)])) : closed(v)]));
	return 'properties' in o && !('additionalProperties' in o) ? { ...o, additionalProperties: false } : o;
}

describe('the OpenAPI document', () => {
	test('documents every API route with its methods, and nothing else', async () => {
		const found = routes().filter(([p]) => !UNDOCUMENTED.includes(p));
		assert.deepEqual(found.map(([p]) => p).sort(), Object.keys(paths).sort());
		for (const [p, file] of found) {
			const exported = Object.keys(await import(file.href)).filter((m) => METHODS.includes(m)).sort();
			assert.deepEqual(exported, Object.keys(paths[p]).map((m) => m.toUpperCase()).sort(), p);
		}
	});

	test('every operation is served by operation(), which takes its name, checks and usage count from the document', async () => {
		for (const [p, file] of routes().filter(([p]) => !UNDOCUMENTED.includes(p))) {
			assert.doesNotMatch(readFileSync(file, 'utf8'), /\bcounted\(/, `${p} counts itself instead of through operation()`);
			const mod = await import(file.href);
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

describe('real responses fit it', { skip: !existsSync(INDEX) && 'build the index first' }, () => {
	const pg = new PGlite({ extensions: { vector } });
	const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
	ajv.addSchema({ $id: 'spec', components: closed(spec.components) });
	const seen = new Set<string>();
	let key = '';
	let discussed = '';

	before(async () => {
		for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
		// Every discussed record and a few hundred others: enough for each field to appear, quick to load.
		const all: Item[] = JSON.parse(readFileSync(INDEX, 'utf8')).items;
		const items = [...all.filter((i) => (i.discussion as unknown[] | undefined)?.length), ...all.filter((i) => !i.discussion).slice(0, 300)];
		await load(pg, items);
		discussed = items.find((i) => (i.discussion as unknown[]).length > 2)!.id as string;
		// A stance on each kind of link and a reviewed reception, so those fields are served and checked too.
		const rec = items.find((i) => i.id === discussed)!;
		const links = (rec.discussion as { url: string }[]).map((d, n) => ({ ...d, stance: n ? 'confirms' : 'questions' }));
		const reception = { text: 'Checked by two readers; one gap is open.', written: '2026-10-25', links: [links[0].url], reviewed_by: 'someone' };
		await pg.query("UPDATE open_index.records SET record = record || jsonb_build_object('discussion', $2::jsonb, 'reception', $3::jsonb) WHERE id = $1",
			[discussed, JSON.stringify(links), JSON.stringify(reception)]);
		(globalThis as { openIndexDb?: Promise<unknown> }).openIndexDb = Promise.resolve(pg); // what lib/db.ts hands every route
		key = await createAgentKey(pg, 'someone', 'Test agent');
	});

	// Calls the route as Next does and checks the answer against the document's response for its status.
	async function call(method: string, path: string, opts: { query?: string; body?: unknown; auth?: boolean; params?: Record<string, string> } = {}) {
		const tmpl = Object.keys(paths).find((p) => new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path))!;
		const file = routes().find(([p]) => p === tmpl)![1];
		const ids = tmpl.match(/\{([^}]+)\}/g)?.map((x) => x.slice(1, -1)) ?? [];
		const values = path.split('/').filter((_, n) => tmpl.split('/')[n]?.startsWith('{'));
		const params = Promise.resolve(Object.fromEntries(ids.map((k, n) => [k, values[n]])));
		const req = new Request(`http://test${path}${opts.query ? `?${opts.query}` : ''}`, {
			method, headers: { 'content-type': 'application/json', ...(opts.auth ? { authorization: `Bearer ${key}` } : {}) },
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
		return { status: res.status, text };
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
		const [p, s] = discussed.split('/');
		await call('GET', `/api/v1/records/${p}/${encodeURIComponent(s)}`);
		assert.equal((await call('GET', '/api/v1/records/nope/nothing')).status, 404);
	});

	test('comments and votes, read and written with an agent key', async () => {
		const at = `/api/v1/records/${discussed.split('/')[0]}/${encodeURIComponent(discussed.split('/')[1])}`;
		assert.equal((await call('POST', `${at}/comments`, { body: { body: 'A first reading.' } })).status, 401);
		const c = JSON.parse((await call('POST', `${at}/comments`, { body: { body: 'A first reading.', review: true }, auth: true })).text);
		await call('POST', `${at}/comments`, { body: { body: 'A reply.', parent: c.id }, auth: true });
		assert.equal((await call('POST', `${at}/comments`, { body: { body: '' }, auth: true })).status, 400);
		await call('GET', `${at}/comments`);
		await call('POST', `${at}/vote`, { body: { value: 1, emoji: '🤔', note: 'Worth checking.' }, auth: true });
		assert.equal((await call('POST', `${at}/vote`, { body: { value: 7 }, auth: true })).status, 400);
		await call('GET', `${at}/vote`);
		await call('DELETE', `${at}/vote`, { auth: true });
		assert.equal((await call('DELETE', `${at}/vote`)).status, 401);
		assert.equal((await call('POST', `${at}/vote`, { body: { value: 1 } })).status, 401);
		for (const [method, path, body] of [['POST', 'comments', { body: 'Hello.' }], ['POST', 'vote', { value: 1 }], ['DELETE', 'vote', undefined]] as const) {
			assert.equal((await call(method, `/api/v1/records/nope/nothing/${path}`, { body, auth: true })).status, 404, `${method} ${path}`);
		}
	});

	test('prefixes, usage stats and the agent-key device flow', async () => {
		await call('GET', '/api/v1/prefixes');
		await call('GET', '/api/v1/stats', { query: 'weeks=2' });
		const d = JSON.parse((await call('POST', '/api/v1/keys/device', { body: { agent: 'Test agent' } })).text);
		assert.equal((await call('POST', '/api/v1/keys/device', { body: { agent: ' ' } })).status, 400);
		assert.equal((await call('POST', '/api/v1/keys/token', { body: { device_code: d.device_code } })).status, 400);
		await approveDevice(pg, d.user_code, 'someone'); // what the person does on /keys/approve
		assert.match((await call('POST', '/api/v1/keys/token', { body: { device_code: d.device_code } })).text, /oik_/);
	});

	test('a request the document does not allow is a 400 that says what to send', async () => {
		const at = `/api/v1/records/${discussed.split('/')[0]}/${encodeURIComponent(discussed.split('/')[1])}`;
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
		assert.match((await error('GET', '/api/v1/stats', { query: 'weeks=27' })).message, /^weeks must be from 1 to 26$/);
		await error('POST', '/api/v1/keys/token', { query: 'format=xml', body: { device_code: 'x' } });
		// Bodies: required fields, types, lengths, and one of several fields.
		assert.match((await error('POST', '/api/v1/keys/token', { body: {} })).message, /^the body needs "device_code"$/);
		assert.match((await error('POST', '/api/v1/keys/device', { body: { agent: 5 } })).message, /^"agent" must be a string$/);
		assert.equal((await error('POST', '/api/v1/keys/device', { body: ['Test agent'] })).code, 'bad_body');
		assert.match((await error('POST', `${at}/comments`, { body: { body: 'x'.repeat(4001) }, auth: true })).message, /^"body" is longer than 4000 characters$/);
		assert.match((await error('POST', `${at}/comments`, { body: { body: 'Hi.', review: 'yes' }, auth: true })).message, /^"review" must be a boolean$/);
		assert.deepEqual(await error('POST', `${at}/vote`, { body: { note: 'Why not.' }, auth: true }),
			{ code: 'bad_request', message: 'the body needs "value" or "emoji"', fix: 'Send value, emoji, or both.' });
		assert.match((await error('POST', `${at}/vote`, { body: { value: 1, note: 'x'.repeat(501) }, auth: true })).message, /^"note" is longer than 500 characters$/);
		// The domain's own checks still answer after the document's.
		assert.match((await error('POST', '/api/v1/keys/device', { body: { agent: '   ' } })).message, /needs a name/);
		assert.match((await error('POST', `${at}/vote`, { body: { emoji: 'no' }, auth: true })).message, /one emoji/);
	});

	test('query strings are read as the declared types, with their defaults', async () => {
		assert.equal(JSON.parse((await call('GET', '/api/v1/search', { query: 'limit=3' })).text).count, 3);
		assert.equal(JSON.parse((await call('GET', '/api/v1/search')).text).count, 20);
		assert.equal(JSON.parse((await call('GET', '/api/v1/stats')).text).weeks, 8);
		assert.equal((await call('POST', `/api/v1/records/${discussed.split('/')[0]}/${encodeURIComponent(discussed.split('/')[1])}/comments`, { body: { body: 'A reply to nothing.', parent: null }, auth: true })).status, 201);
	});

	test('/api/v1 and /llms.txt list the operations from the document', async () => {
		const ops = Object.entries(paths).flatMap(([p, o]) => Object.entries(o).map(([m, op]) => ({ name: `${m.toUpperCase()} ${p}`, id: (op as unknown as { operationId: string }).operationId })));
		const index = await (await (await import(new URL('route.ts', API).href)).GET(new Request('http://test/api/v1'))).json();
		assert.deepEqual(index.endpoints.map((e: { id: string }) => e.id), ops.map((o) => o.id));
		const llms = await (await (await import(new URL('../../llms.txt/route.ts', API).href)).GET(new Request('http://test/llms.txt'))).text();
		for (const { name } of ops) assert.ok(llms.includes(`${name}`), `llms.txt leaves out ${name}`);
	});

	test('every documented response was checked', () => {
		const documented = Object.entries(paths).flatMap(([p, ops]) => Object.entries(ops).flatMap(([m, op]) => Object.keys(op.responses).map((s) => `${m} ${p} ${s}`)));
		assert.deepEqual(documented.filter((d) => !seen.has(d)), []);
	});
});
