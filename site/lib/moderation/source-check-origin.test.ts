import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { requireSourceCheckOrigin } from './source-check-origin.ts';

test('cookie actions require the trusted site/deployment Origin; Bearer API may omit it', () => {
 const site='https://open-research-index.vercel.app', deployment='ori-preview.vercel.app';
 assert.doesNotThrow(() => requireSourceCheckOrigin(site,true,site,deployment));
 assert.doesNotThrow(() => requireSourceCheckOrigin(`https://${deployment}`,true,site,deployment));
 assert.doesNotThrow(() => requireSourceCheckOrigin(null,false,site,deployment));
 assert.throws(() => requireSourceCheckOrigin(null,true,site,deployment), /same-origin/);
 assert.throws(() => requireSourceCheckOrigin('https://another.example.org',false,site,deployment), /same-origin/);
 assert.throws(() => requireSourceCheckOrigin(`${site}/`,false,site,deployment), /same-origin/);
});
