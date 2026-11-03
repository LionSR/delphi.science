// Page helpers: where a record stands, its source tag, and where to read the original.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { original, reception, source } from './view.ts';

test('a record with a reviewed reception shows it; anything else shows none', () => {
	const stands = { text: 'Withdrawn after a sign error.', written: '2026-10-07', links: ['https://e.org/a'], reviewed_by: 'LionSR' };
	assert.deepEqual(reception({ reception: stands }), stands);
	for (const r of [{}, { reception: {} }, { reception: { text: '' } }, { reception: 'text' }]) assert.equal(reception(r), null);
});

test('a source tag links to the index filtered by source, never to the work itself', () => {
	const tag = source('arxiv');
	assert.equal(tag.name, 'arXiv');
	assert.equal(tag.href, '/?q=source:arxiv');
	assert.match(tag.title, /^All arXiv records on /);
	assert.equal(source('unknown').name, 'unknown');
});

test('the original is the record url, shown without scheme or www. and with its host; records without a url have none', () => {
	assert.deepEqual(original({ url: 'https://arxiv.org/abs/2610.31580' }),
		{ href: 'https://arxiv.org/abs/2610.31580', host: 'arxiv.org', label: 'arxiv.org/abs/2610.31580' });
	assert.deepEqual(original({ url: 'https://www.anthropic.com/research/agents-in-biology/' }),
		{ href: 'https://www.anthropic.com/research/agents-in-biology/', host: 'anthropic.com', label: 'anthropic.com/research/agents-in-biology' });
	const long = `https://example.org/${'a'.repeat(80)}`;
	const shown = original({ url: long })!;
	assert.equal(shown.href, long);
	assert.equal(shown.label.length, 60);
	assert.ok(shown.label.endsWith('…'));
	for (const r of [{}, { url: '' }, { url: 'ftp://x.org/a' }, { url: 42 }]) assert.equal(original(r), null);
});
