// site/openapi.json, the static copy of the OpenAPI document that test_index.py reads, matches lib/openapi.ts.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FILE, openapiJson } from '../scripts/openapi.ts';

test('site/openapi.json is the current OpenAPI document (npm run openapi rewrites it)', async () => {
	assert.ok(readFileSync(FILE, 'utf8') === await openapiJson(), 'site/openapi.json is stale: run npm run openapi in site/ and commit it');
});
