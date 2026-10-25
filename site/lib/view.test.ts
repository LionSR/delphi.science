// The page helpers that decide what a record shows: its tally, and where it stands.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { reception, tally } from './view.ts';

test('a record with a reviewed reception shows it; anything else shows none', () => {
	const stands = { text: 'Withdrawn after a sign error.', written: '2026-10-07', links: ['https://e.org/a'], reviewed_by: 'LionSR' };
	assert.deepEqual(reception({ reception: stands }), stands);
	for (const r of [{}, { reception: {} }, { reception: { text: '' } }, { reception: 'text' }]) assert.equal(reception(r), null);
});

test('the tally names responses and a dispute', () => {
	assert.equal(tally({ score: 2, discussed: 3, disputed: true }), 'score 2 · 🔥 3 posts · disputed');
	assert.equal(tally({ discussed: 1 }), 'score 0 · 🔥 1 post');
});
