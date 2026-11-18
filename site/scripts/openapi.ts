// Writes lib/api/openapi.ts to site/openapi.json (`npm run openapi`), and the part of it the command line reads to
// cli/api.json. test_index.py validates records against the first, and lib/api/openapi-file.test.ts fails while either
// is stale. SITE_URL is ignored so the file always names the public site.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FILE = fileURLToPath(new URL('../openapi.json', import.meta.url));

export async function openapiJson(): Promise<string> {
	delete process.env.SITE_URL; // before lib/view.ts reads it
	const { spec } = await import('#lib/api/openapi.ts');
	return `${JSON.stringify(spec, null, '\t')}\n`;
}

/** cli/api.json: the part of the document the command line (cli/delphi.mjs) is built from. It holds the six verbs
 * and the operations login and logout call, each with what it takes and what it says it does, and no replies. */
export const CLI_FILE = fileURLToPath(new URL('../../cli/api.json', import.meta.url));
const CLI_ALSO = ['requestAgentKey', 'redeemAgentKey', 'listAgentKeys', 'revokeAgentKey'];

export async function cliJson(): Promise<string> {
	delete process.env.SITE_URL;
	const { spec, VERBS } = await import('#lib/api/openapi.ts');
	const wanted: readonly string[] = [...VERBS, ...CLI_ALSO];
	type Op = { operationId: string; summary: string; description?: string; security?: unknown; parameters?: unknown; requestBody?: unknown };
	const paths = Object.fromEntries(Object.entries(spec.paths as Record<string, Record<string, Op>>).flatMap(([path, item]) => {
		const ops = Object.entries(item).filter(([, op]) => wanted.includes(op.operationId))
			.map(([method, { operationId, summary, description, security, parameters, requestBody }]) => [method, { operationId, summary, description, security, parameters, requestBody }]);
		return ops.length ? [[path, Object.fromEntries(ops)]] : [];
	}));
	return `${JSON.stringify({ openapi: spec.openapi, info: { title: spec.info.title, version: spec.info.version }, servers: spec.servers, 'x-commands': VERBS, paths }, null, '\t')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(FILE, await openapiJson());
	writeFileSync(CLI_FILE, await cliJson());
	console.log(`wrote ${FILE} and ${CLI_FILE}`);
}
