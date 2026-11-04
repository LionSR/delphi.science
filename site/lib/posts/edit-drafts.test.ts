import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readEditDraft, writeEditDraft, clearEditDraft } from './edit-drafts.ts';
import type { DraftStorage } from './drafts.ts';

class Memory implements DraftStorage {
	values = new Map<string, string>();
	getItem(k: string) { return this.values.get(k) ?? null; }
	setItem(k: string, v: string) { this.values.set(k, v); }
	removeItem(k: string) { this.values.delete(k); }
}

test('edit drafts retain the base revision, isolate owners and post IDs, and clear only the selected draft', () => {
	const s = new Memory();
	const d = { body: 'A correction retained after refusal.', revision: '123' };
	writeEditDraft(s, 'alice', 1, d);
	writeEditDraft(s, 'alice', 2, { body: 'Second', revision: '2' });
	assert.deepEqual(readEditDraft(s, 'alice', 1), d);
	assert.equal(readEditDraft(s, 'bob', 1), undefined);
	clearEditDraft(s, 'alice', 1);
	assert.equal(readEditDraft(s, 'alice', 1), undefined);
	assert.equal(readEditDraft(s, 'alice', 2)?.body, 'Second');
});

test('an edit draft holding an agent key is dropped, and broken storage never throws', () => {
	const s = new Memory();
	writeEditDraft(s, 'alice', 2, { body: 'Second', revision: '2' });
	writeEditDraft(s, 'alice', 2, { body: `oik_${'a'.repeat(48)}`, revision: '2' });
	assert.equal(readEditDraft(s, 'alice', 2), undefined);
	assert.equal(s.values.size, 0);
	const broken: DraftStorage = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
	assert.doesNotThrow(() => writeEditDraft(broken, 'alice', 1, { body: 'Draft', revision: '1' }));
	assert.equal(readEditDraft(broken, 'alice', 1), undefined);
	assert.doesNotThrow(() => clearEditDraft(broken, 'alice', 1));
});
