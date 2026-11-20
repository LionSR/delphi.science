import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
	clearDraft, emptyDraft, markDraftLogin, restoreDraft, saveDraft,
	type Draft, type DraftStorage,
} from './drafts.ts';

class MemoryStorage implements DraftStorage {
	values = new Map<string, string>();
	getItem(key: string) { return this.values.get(key) ?? null; }
	setItem(key: string, value: string) { this.values.set(key, value); }
	removeItem(key: string) { this.values.delete(key); }
}

const draft = (body = 'At x=0 the two sides coincide. Is x>0 required?', title = ''): Draft =>
	({ title, body, review: false });
const question = draft('For an open chain the telescoping sum leaves endpoint terms.', 'Which boundary conditions are assumed?');
const guestDraft = draft('My pre-login clarification about the endpoint terms.', 'Boundary terms');

describe('private post drafts', () => {
	test('keeps each author’s draft for each form, topic and parent separate', () => {
		const storage = new MemoryStorage();
		const cases: [string, string, Draft][] = [
			['ask', 'alice', question],
			['ask', 'bob', draft('Bob’s separate question.')],
			['answer:1', 'alice', draft('An answer to topic one.')],
			['answer:2', 'alice', draft('An answer to topic two.')],
			['comment:1:6', 'alice', draft('A comment on post six.')],
			['comment:1:7', 'alice', draft('A comment on post seven.')],
			['review:record/one', 'alice', { ...draft('A specific review.'), review: true }],
			// The review choice is kept even while the text is empty.
			['record:one', 'alice', { ...emptyDraft(), review: true }],
			// Separator-like characters in names cannot make two keys collide.
			['b:c/%', 'a', draft('Under form b:c/%.')],
			['c/%', 'a:b', draft('Under owner a:b.')],
			// A signed-in owner named guest is not the anonymous author.
			['ask', '', guestDraft],
			['ask', 'guest', draft('The account named guest.')],
		];
		for (const [form, owner, d] of cases) assert.equal(saveDraft(storage, form, owner, d), true);
		for (const [form, owner, d] of cases) assert.deepEqual(restoreDraft(storage, form, owner).draft, d);
		assert.deepEqual(restoreDraft(storage, 'answer:3', 'alice').draft, emptyDraft());
		assert.deepEqual(restoreDraft(storage, 'ask', 'carol').draft, emptyDraft());
	});

	test('does not migrate a guest draft without an explicit login marker', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', '', guestDraft);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: emptyDraft() });
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
	});

	test('migrates only the form whose guest author intentionally starts login', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', '', guestDraft);
		saveDraft(storage, 'comment:1:6', '', question);
		markDraftLogin(storage, 'ask', '');
		assert.deepEqual(restoreDraft(storage, 'comment:1:6', 'alice').draft, emptyDraft());
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: guestDraft });
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: guestDraft });
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, emptyDraft());
		assert.deepEqual(restoreDraft(storage, 'comment:1:6', '').draft, question);
	});
	test('clearing after a confirmed post, or saving an emptied form, removes only that owner’s form', () => {
		const clears = [
			(storage: DraftStorage) => clearDraft(storage, 'ask', 'alice'),
			(storage: DraftStorage) => assert.equal(saveDraft(storage, 'ask', 'alice', emptyDraft()), true),
		];
		for (const clear of clears) {
			const storage = new MemoryStorage();
			saveDraft(storage, 'ask', 'alice', question);
			saveDraft(storage, 'ask', 'bob', guestDraft);
			saveDraft(storage, 'comment:1:6', 'alice', guestDraft);
			clear(storage);
			assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, emptyDraft());
			assert.deepEqual(restoreDraft(storage, 'ask', 'bob').draft, guestDraft);
			assert.deepEqual(restoreDraft(storage, 'comment:1:6', 'alice').draft, guestDraft);
		}
	});
});
