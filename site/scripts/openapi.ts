// Writes the OpenAPI document (lib/openapi.ts) to site/openapi.json, a static copy for tools that cannot run
// TypeScript: test_index.py checks the records index.py builds against its Record schema, and importers can read
// it from the repository. Run it after changing lib/openapi.ts; lib/openapi-file.test.ts fails while it is stale.
//
//   npm run openapi
//
// The copy always names the public site: SITE_URL is ignored here.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FILE = fileURLToPath(new URL('../openapi.json', import.meta.url));

/** The document as site/openapi.json holds it. */
export async function openapiJson(): Promise<string> {
	delete process.env.SITE_URL; // before lib/view.ts reads it
	const { spec } = await import('../lib/openapi.ts');
	return `${JSON.stringify(spec, null, '\t')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(FILE, await openapiJson());
	console.log(`wrote ${FILE}`);
}
