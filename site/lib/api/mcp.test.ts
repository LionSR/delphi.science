// The MCP tools' schemas follow the OpenAPI document, and their real results fit them (objects closed).
// Needs a build: python3 index.py build.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { load, type Item } from '#lib/records/load.ts';
import { handle } from './mcp.ts';
import { operationById, spec } from './openapi.ts';
import { closed } from './schema.ts';
import type { Db } from '#lib/db.ts';
import { BUILD, migratedDb, sampleItems } from '#lib/testing.ts';

type Json = Record<string, any>;
type Tool = { name: string; description: string; inputSchema: Json; outputSchema: Json };

const rpc = async (db: Db, method: string, params: object = {}) => {
	const req = new Request('http://localhost/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } });
	return (await (await handle(req, async () => db)).json()).result;
};
const noDb: Db = { query: async () => { throw new Error('no database in this test'); } };
const listTools = async (db = noDb) => Object.fromEntries(((await rpc(db, 'tools/list')).tools as Tool[]).map((t) => [t.name, t]));

const components = spec.components.schemas as Record<string, Json>;
// A schema from the document with its $refs written out, as the tools show it.
const inline = (s: unknown): any => Array.isArray(s) ? s.map(inline) : !s || typeof s !== 'object' ? s
	: typeof (s as Json).$ref === 'string' ? inline(components[(s as Json).$ref.split('/').pop()])
		: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, inline(v)]));
const param = (p: Json) => ({ ...p.schema, ...(p.description ? { description: p.description } : {}) });
const without = (o: Json, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
/** The parts of data that the tool's output schema, closed, does not allow. */
const problems = (schema: Json, data: unknown) => {
	const validate = ajv.compile(closed(without(schema, '$schema')) as object);
	return validate(data) ? [] : [...new Set(validate.errors!.map((e) =>
		`${e.instancePath.replace(/\/\d+/g, '[]') || '(body)'} ${e.params.additionalProperty ? `serves ${e.params.additionalProperty}, which is not documented` : e.message}`))];
};

describe('the MCP tools follow the OpenAPI document', () => {
	test('search takes searchRecords\' query parameters, but format, and says which apply to records only', async () => {
		const { search: t } = await listTools();
		const params = operationById('searchRecords').parameters.filter((p) => p.name !== 'format');
		assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), [...params.map((p) => p.name), 'in'].sort());
		for (const p of params) {
			// The same type, enum, limits and default, length caps included; the description is the document's, with a prefix where it needs one.
			assert.deepEqual(without(t.inputSchema.properties[p.name], 'description'), without(param(p), 'description'), p.name);
			assert.ok(t.inputSchema.properties[p.name].description.includes(p.description), p.name);
		}
		for (const name of ['sort', 'fields']) assert.ok(t.inputSchema.properties[name].description.startsWith('Records only. '), name);
		assert.deepEqual(t.inputSchema.properties.in.enum, ['records', 'forum']);
		assert.ok(t.description.startsWith(operationById('searchRecords').summary));
	});

	test('get, post, edit and vote take a path as id; edit and vote keep the REST bodies\' fields', async () => {
		const tools = await listTools();
		for (const name of ['get', 'post', 'edit', 'vote']) {
			assert.ok(tools[name].inputSchema.required.includes('id'), name);
			assert.deepEqual([tools[name].inputSchema.properties.id.type, tools[name].inputSchema.properties.id.maxLength], ['string', 320], name);
		}
		assert.ok(tools.get.description.includes(operationById('getRecord').summary));
		const body = (id: string) => operationById(id).body!.properties as Json;
		assert.deepEqual(without(tools.edit.inputSchema.properties, 'id'), body('editPost'));
		for (const k of ['emoji', 'note', 'if_absent', 'retrieve_sources']) assert.deepEqual(without(tools.vote.inputSchema.properties[k], 'description'), without(body('vote')[k], 'description'), k);
		assert.equal(tools.post.inputSchema.properties.body.maxLength, body('postComment').body.maxLength);
		assert.deepEqual(without(tools.post.inputSchema.properties.title, 'description'), without(body('askQuestion').title, 'description'));
	});

	test('outputs are Record and SearchResult, with page for links and responses shown as quotes', async () => {
		const { search: s, get: g } = await listTools();
		const record = inline(components.Record);
		const link = inline(components.Link).properties;
		// Every field of Record as the document states it, except links (replaced by page), discussion (below) and id (a path).
		for (const [k, v] of Object.entries(without(record.properties, 'links', 'discussion', 'id'))) assert.deepEqual(g.outputSchema.properties[k], v, k);
		assert.deepEqual(g.outputSchema.required, ['id']);
		const shown = g.outputSchema.properties.discussion.items.properties;
		assert.deepEqual({ quote: shown.quote, date: shown.date, url: shown.url }, { quote: link.text, date: link.date, url: link.url });
		// SearchResult as the document states it, except took_ms; its results are records as get shows them, or topics.
		const result = inline(components.SearchResult);
		assert.deepEqual(without(s.outputSchema.properties, 'results'), without(result.properties, 'results', 'took_ms'));
		assert.deepEqual(s.outputSchema.required, result.required);
		const item = s.outputSchema.properties.results.items.properties;
		for (const [k, v] of Object.entries(without(record.properties, 'links', 'discussion'))) assert.deepEqual(item[k], v, k);
		assert.deepEqual(item.discussion, g.outputSchema.properties.discussion);
		for (const k of ['answers', 'accepted', 'last_at', 'latest_response']) assert.ok(item[k], k);
	});
});

describe('what the tools return fits their output schemas, closed', { skip: !existsSync(BUILD) && 'build the index first' }, () => {
	let pg: PGlite;
	let tools: Record<string, Tool> = {};
	let discussed = '';
	before(async () => {
		pg = await migratedDb();
		const items = sampleItems();
		await load(pg, items);
		discussed = items.find((i) => (i.discussion as unknown[]).length > 2)!.id as string;
		tools = await listTools(pg);
	});
	const call = async (name: string, args: object) => {
		const r = await rpc(pg, 'tools/call', { name, arguments: args });
		assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
		assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent);
		return r.structuredContent;
	};

	test('get: a real record fits, and a field the schema leaves out does not', async () => {
		const rec = await call('get', { id: discussed });
		assert.ok(rec.discussion.length > 2);
		assert.deepEqual(problems(tools.get.outputSchema, rec), []);
		assert.deepEqual(problems(tools.get.outputSchema, { ...rec, secret: 1 }), ['(body) serves secret, which is not documented']);
		assert.deepEqual(problems(tools.get.outputSchema, { ...rec, discussion: [{ ...rec.discussion[0], kind: 'web' }] }),
			['/discussion[] serves kind, which is not documented']);
	});

	test('search: records compact and full, by newest response with that response, and the forum', async () => {
		for (const args of [{ q: 'is:discussed', limit: 5 }, { q: `id:${JSON.stringify(discussed)}`, fields: 'full' }, { limit: 3, sort: 'responded' }, { in: 'forum' }]) {
			assert.deepEqual(problems(tools.search.outputSchema, await call('search', args)), [], JSON.stringify(args));
		}
		for (const args of [{ q: 'is:discussed', sort: 'responded', limit: 5 }, { q: 'is:discussed AND (source:openai-math)', sort: 'responded', limit: 2, fields: 'full' }]) {
			const found = await call('search', args);
			assert.deepEqual(problems(tools.search.outputSchema, found), [], JSON.stringify(args));
			assert.ok(found.results.length && found.results.every((r: Json) => r.latest_response?.url && r.discussed), JSON.stringify(args));
			assert.equal('discussion' in found.results[0], args.fields === 'full');
		}
	});

	test('get shows each response\'s stance, and says what a path is when it names nothing', async () => {
		const links = (await call('get', { id: discussed })).discussion.map((d: Json) => ({ url: d.url, stance: 'questions' }));
		await pg.query("UPDATE open_index.records SET record = jsonb_set(record, '{discussion}', (SELECT jsonb_agg(d || '{\"stance\": \"questions\"}') FROM jsonb_array_elements(record->'discussion') d)) WHERE id = $1", [discussed]);
		const rec = await call('get', { id: discussed });
		assert.deepEqual(rec.discussion.map((d: Json) => ({ url: d.url, stance: d.stance })), links);
		assert.deepEqual(problems(tools.get.outputSchema, rec), []);
		const bad = await rpc(pg, 'tools/call', { name: 'get', arguments: { id: 'no slash here' } });
		assert.ok(bad.isError && /^no no slash here\. A path: a record id \(arxiv\//.test(bad.content[0].text), bad.content[0].text);
	});
});
