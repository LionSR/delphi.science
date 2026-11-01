// Writes lib/openapi.ts to site/openapi.json (`npm run openapi`). test_index.py validates records against it, and
// lib/openapi-file.test.ts fails while it is stale. SITE_URL is ignored so the file always names the public site.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FILE = fileURLToPath(new URL('../openapi.json', import.meta.url));

export async function openapiJson(): Promise<string> {
	delete process.env.SITE_URL; // before lib/view.ts reads it
	const { spec } = await import('../lib/openapi.ts');
	return `${JSON.stringify(spec, null, '\t')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	writeFileSync(FILE, await openapiJson());
	console.log(`wrote ${FILE}`);
}
