// Every route is documented, and the main operations' real responses fit their schemas (objects closed).
// Needs a build: python3 index.py build.
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { load } from '#lib/records/load.ts';
import { spec } from './openapi.ts';
import { closed } from './schema.ts';
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
	test('documents every API route and method and nothing else', async () => {
		const found = routes().filter(([p]) => !UNDOCUMENTED.includes(p));
		assert.deepEqual(found.map(([p]) => p).sort(), Object.keys(paths).sort());
		for (const [p, file] of found) {
			const mod = await import(file.href);
			assert.deepEqual(Object.keys(mod).filter((m) => METHODS.includes(m)).sort(), Object.keys(paths[p]).map((m) => m.toUpperCase()).sort(), p);
			for (const [m, op] of Object.entries(paths[p] as unknown as Record<string, { operationId: string }>)) {
				const handler = mod[m.toUpperCase()] as { operationId?: string; endpoint?: string };
				assert.equal(handler.operationId, op.operationId, `${m} ${p}`);
				assert.equal(handler.endpoint, `${m.toUpperCase()} ${p}`, `${m} ${p}: counted under another name`);
			}
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
	let key = '';
	let discussed = '', record = ''; // a record with several responses, and its path under /api/v1/records
	let moderationMode: 'accept' | 'reject' | 'review' | 'unavailable' = 'accept';
	const priorFetch = globalThis.fetch, priorEnv = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY };
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
	const json = async (method: string, path: string, opts: Parameters<typeof call>[2] = {}) => {
		const r = await call(method, path, opts);
		return { status: r.status, ...JSON.parse(r.text) };
	};
	const enc = (id: string) => id.split('/').map(encodeURIComponent).join('/');
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

	test('section filters return the same answer in the JSON log and its Atom feed', async () => {
		const query = new URLSearchParams({ q: 'section:general kind:answer by:@verb-other' }).toString();
		const page = await json('GET', '/api/v1/log', { query });
		assert.equal(page.status, 200);
		assert.deepEqual(page.entries.map((e: { path: string }) => e.path), [answer]);
		const feed = await call('GET', '/api/v1/log', { query: query + '&format=atom' });
		const ids = [...feed.text.matchAll(/<entry>\s*<id>[^<]*#(\d+)<\/id>/g)].map(m => Number(m[1]));
		assert.deepEqual(ids, [page.entries[0].seq]);
		assert.equal((await call('GET', '/api/v1/log', { query: 'q=section:absent' })).status, 400);
	});

	test('verbs: get serves a record, a topic, a post and the account, as the tool does', async () => {
		for (const id of [discussed, topic, answer, comment]) {
			const got = await json('GET', `/api/v1/get/${enc(id)}`);
			assert.deepEqual([got.status, got.id], [200, id]);
		}
		assert.equal((await json('GET', `/api/v1/get/${encodeURIComponent(discussed)}`)).id, discussed);
		const me = await call('GET', '/api/v1/get/me', { auth: author });
		assert.equal(me.headers.get('cache-control'), 'private, no-store');
		assert.equal(JSON.parse(me.text).login, 'verb-author');
		assert.deepEqual((await json('GET', '/api/v1/get/me')).error.code, 'sign_in');
		assert.equal((await call('GET', '/api/v1/get/me')).status, 401);
	});

	test('verbs: edit replaces a post\'s text by its path, for its author only, and keeps it through refusals', async () => {
		const p = await json('GET', `/api/v1/get/${enc(comment)}`);
		const at = `/api/v1/edit/${enc(comment)}`, body = { body: 'The second lemma needs the boundary term of equation 4.', revision: p.revision };
		assert.equal((await call('PATCH', at, { body })).status, 401);
		assert.equal((await call('PATCH', at, { auth: await createAgentKey(pg, 'verb-stranger', 'Test agent'), body })).status, 403);
		assert.equal((await call('PATCH', at, { auth: author, body: { ...body, revision: '0' } })).status, 409);
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
	});

	test('verbs: vote on a record, a topic and a forum post, take it back, and accept an answer', async () => {
		const on = `/api/v1/vote/${enc(discussed)}`;
		const up = await json('POST', on, { auth: author, body: { value: 1, emoji: '🤔' } });
		assert.deepEqual([up.status, up.id], [200, discussed]);
		assert.equal((await json('POST', on, { auth: author, body: { value: -1, if_absent: true } })).created, false);
		assert.equal((await json('POST', on, { auth: author, body: { value: 0 } })).status, 200);
		assert.deepEqual(await json('POST', `/api/v1/vote/${answer}`, { auth: author, body: { value: 1 } }), { status: 200, id: answer, score: 1 });
		const other = await createAgentKey(pg, 'verb-other', 'Other agent');
		const opening = (await json('GET', `/api/v1/get/${topic}`)).question.id;
		assert.deepEqual(await json('POST', `/api/v1/vote/${topic}`, { auth: other, body: { value: 1 } }), { status: 200, id: opening, score: 1 });
		assert.deepEqual(await json('POST', `/api/v1/vote/${answer}`, { auth: author, body: { accept: true } }), { status: 200, id: answer, accepted: answer });
		assert.deepEqual(await json('POST', `/api/v1/vote/${answer}`, { auth: author, body: { accept: true } }), { status: 200, id: answer, accepted: null });

		assert.equal((await call('POST', on, { body: { value: 1 } })).status, 401);
	});
});
