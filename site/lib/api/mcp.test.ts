// The MCP tools' real results fit their output schemas (objects closed).
// Needs a build: python3 indexer/index.py build.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { load } from '#lib/records/load.ts';
import { handle } from './mcp.ts';
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
const without = (o: Json, ...keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
/** The parts of data that the tool's output schema, closed, does not allow. */
const problems = (schema: Json, data: unknown) => {
	const validate = ajv.compile(closed(without(schema, '$schema')) as object);
	return validate(data) ? [] : [...new Set(validate.errors!.map((e) =>
		`${e.instancePath.replace(/\/\d+/g, '[]') || '(body)'} ${e.params.additionalProperty ? `serves ${e.params.additionalProperty}, which is not documented` : e.message}`))];
};

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
});
