// The MCP tools against the OpenAPI document they are read from: each tool's input is its operation's
// parameters, its output the document's schemas with only what MCP adds, and what the tools really return fits
// that output with objects closed, as openapi.test.ts checks the REST API. The last part needs a build:
// python3 index.py build.
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { load, type Item } from './load.ts';
import { handle } from './mcp.ts';
import { spec } from './openapi.ts';
import { closed } from './schema.ts';
import type { Db } from './query.ts';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const INDEX = new URL('../../dist/index.json', import.meta.url);

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
const operation = (id: string): Json => Object.values(spec.paths as Record<string, Record<string, Json>>).flatMap(Object.values).find((o) => o.operationId === id)!;
const param = (p: Json) => ({ ...p.schema, ...(p.description ? { description: p.description } : {}) });
const without = (o: Json, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
/** What in data the tool's output schema, closed, does not allow. */
const problems = (schema: Json, data: unknown) => {
	const validate = ajv.compile(closed(without(schema, '$schema')) as object);
	return validate(data) ? [] : [...new Set(validate.errors!.map((e) =>
		`${e.instancePath.replace(/\/\d+/g, '[]') || '(body)'} ${e.params.additionalProperty ? `serves ${e.params.additionalProperty}, which is not documented` : e.message}`))];
};

describe('the MCP tools follow the OpenAPI document', () => {
	test('tools/list states each schema the same way every time', async () => {
		assert.deepEqual(await listTools(), await listTools());
	});

	test('search_records takes searchRecords\' query parameters, but format', async () => {
		const { search_records: t } = await listTools();
		const params = (operation('searchRecords').parameters as Json[]).filter((p) => p.name !== 'format');
		assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), params.map((p) => p.name).sort());
		// The same type, enum, limits, default and description, length caps included.
		for (const p of params) assert.deepEqual(t.inputSchema.properties[p.name], param(p), p.name);
		assert.ok(t.description.startsWith(operation('searchRecords').summary));
	});

	test('list_discussed_records takes the same, with its query in q\'s syntax and no q or sort', async () => {
		const { search_records: s, list_discussed_records: t } = await listTools();
		assert.deepEqual(without(t.inputSchema.properties, 'query'), without(s.inputSchema.properties, 'q', 'sort'));
		assert.deepEqual(without(t.inputSchema.properties.query, 'description'), without(s.inputSchema.properties.q, 'description'));
		assert.ok(t.inputSchema.properties.query.description.endsWith(s.inputSchema.properties.q.description));
	});

	test('get_record takes getRecord\'s path parameters as one id', async () => {
		const { get_record: t } = await listTools();
		assert.deepEqual(t.inputSchema.required, ['id']);
		for (const p of operation('getRecord').parameters as Json[]) assert.ok(t.inputSchema.properties.id.description.includes(p.description), p.name);
		assert.ok(t.description.startsWith(operation('getRecord').summary));
	});

	test('outputs are Record and SearchResult, with page for links and responses shown as quotes', async () => {
		const { search_records: s, get_record: g, list_discussed_records: l } = await listTools();
		const record = inline(components.Record);
		const link = inline(components.Link).properties;
		// Every field of Record as the document states it, but links (page instead) and discussion (below).
		assert.deepEqual(without(g.outputSchema.properties, 'page', 'discussion'), without(record.properties, 'links', 'discussion'));
		assert.deepEqual(g.outputSchema.required, [...record.required, 'page', 'discussion', 'discusses']);
		const shown = g.outputSchema.properties.discussion.items.properties;
		assert.deepEqual({ quote: shown.quote, date: shown.date, url: shown.url }, { quote: link.text, date: link.date, url: link.url });
		// SearchResult as the document states it, but took_ms; its results are the record as get_record shows it.
		const result = inline(components.SearchResult).properties;
		assert.deepEqual(without(s.outputSchema.properties, 'results'), without(result, 'results', 'took_ms'));
		assert.deepEqual(s.outputSchema.properties.results.items, { ...without(g.outputSchema, '$schema'), required: record.required });
		assert.deepEqual(without(l.outputSchema.properties, 'results'), without(result, 'results', 'took_ms', 'sort'));
		assert.deepEqual(without(l.outputSchema.properties.results.items.properties, 'latest_response'), g.outputSchema.properties);
	});
});

describe('what the tools return fits their output schemas, closed', { skip: !existsSync(INDEX) && 'build the index first' }, () => {
	const pg = new PGlite({ extensions: { vector } });
	let tools: Record<string, Tool> = {};
	let discussed = '';
	before(async () => {
		for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
		// Every discussed record and a few hundred others, as in openapi.test.ts.
		const all: Item[] = JSON.parse(readFileSync(INDEX, 'utf8')).items;
		const items = [...all.filter((i) => (i.discussion as unknown[] | undefined)?.length), ...all.filter((i) => !i.discussion).slice(0, 300)];
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

	test('get_record: a real record fits, and a field the schema leaves out does not', async () => {
		const rec = await call('get_record', { id: discussed });
		assert.ok(rec.discussion.length > 2);
		assert.deepEqual(problems(tools.get_record.outputSchema, rec), []);
		assert.deepEqual(problems(tools.get_record.outputSchema, { ...rec, secret: 1 }), ['(body) serves secret, which is not documented']);
		assert.deepEqual(problems(tools.get_record.outputSchema, { ...rec, discussion: [{ ...rec.discussion[0], kind: 'web' }] }),
			['/discussion[] serves kind, which is not documented']);
	});

	test('search_records and list_discussed_records, compact and full', async () => {
		for (const args of [{ q: 'is:discussed', limit: 5 }, { q: `id:${JSON.stringify(discussed)}`, fields: 'full' }, { limit: 3, sort: 'responded' }]) {
			assert.deepEqual(problems(tools.search_records.outputSchema, await call('search_records', args)), [], JSON.stringify(args));
		}
		for (const args of [{ limit: 5 }, { query: 'source:openai-math', limit: 2, fields: 'full' }]) {
			assert.deepEqual(problems(tools.list_discussed_records.outputSchema, await call('list_discussed_records', args)), [], JSON.stringify(args));
		}
	});

	test('get_record shows each response\'s stance, and says what an id looks like when one is malformed', async () => {
		const links = (await call('get_record', { id: discussed })).discussion.map((d: Json) => ({ url: d.url, stance: 'questions' }));
		await pg.query("UPDATE open_index.records SET record = jsonb_set(record, '{discussion}', (SELECT jsonb_agg(d || '{\"stance\": \"questions\"}') FROM jsonb_array_elements(record->'discussion') d)) WHERE id = $1", [discussed]);
		const rec = await call('get_record', { id: discussed });
		assert.deepEqual(rec.discussion.map((d: Json) => ({ url: d.url, stance: d.stance })), links);
		assert.deepEqual(problems(tools.get_record.outputSchema, rec), []);
		const bad = await rpc(pg, 'tools/call', { name: 'get_record', arguments: { id: 'no slash here' } });
		assert.ok(bad.isError && /a record id is <prefix>\/<suffix>/.test(bad.content[0].text), bad.content[0].text);
	});

	test('query, search_records\' old name for q, still answers the same', async () => {
		assert.deepEqual(await call('search_records', { query: 'is:discussed', limit: 3 }), await call('search_records', { q: 'is:discussed', limit: 3 }));
	});
});
