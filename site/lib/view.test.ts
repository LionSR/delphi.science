// The page helper that decides where a record stands.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { reception } from './view.ts';

test('a record with a reviewed reception shows it; anything else shows none', () => {
	const stands = { text: 'Withdrawn after a sign error.', written: '2026-10-07', links: ['https://e.org/a'], reviewed_by: 'LionSR' };
	assert.deepEqual(reception({ reception: stands }), stands);
	for (const r of [{}, { reception: {} }, { reception: { text: '' } }, { reception: 'text' }]) assert.equal(reception(r), null);
});
