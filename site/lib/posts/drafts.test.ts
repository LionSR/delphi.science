import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
	adoptGuestDraft, clearDraft, emptyDraft, markDraftLogin, restoreDraft, saveDraft,
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

	/** A guest signs in as alice, who already has a draft of her own: the guest draft is offered beside it. */
	function offeredToAlice() {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', '', guestDraft);
		saveDraft(storage, 'ask', 'alice', question);
		markDraftLogin(storage, 'ask', '');
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: question, alternate: guestDraft });
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
		return storage;
	}

	test('prefers an existing owner draft and offers the explicitly carried guest draft separately', () => {
		const storage = offeredToAlice();
		assert.equal(adoptGuestDraft(storage, 'ask', 'alice', guestDraft), true);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: guestDraft });
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, emptyDraft());
	});

	test('a guest draft offered to one account can be neither adopted nor restored by another', () => {
		const storage = offeredToAlice();
		const bobsDraft = draft('Bob’s independent draft.');
		saveDraft(storage, 'ask', 'bob', bobsDraft);
		assert.equal(adoptGuestDraft(storage, 'ask', 'bob', guestDraft), false);
		assert.deepEqual(restoreDraft(storage, 'ask', 'bob'), { draft: bobsDraft });
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
		// Bob's attempt drops the marker, so alice is no longer offered the guest draft either.
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: question });
	});

	test('a signed-in author’s login marker never transfers a draft to another account', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'answer:1', 'alice', question);
		markDraftLogin(storage, 'answer:1', 'alice');
		assert.deepEqual(restoreDraft(storage, 'answer:1', 'bob').draft, emptyDraft());
		assert.deepEqual(restoreDraft(storage, 'answer:1', 'alice').draft, question);
	});

	test('adopting an alternate without login intent is refused and leaves stored drafts unchanged', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', '', guestDraft);
		saveDraft(storage, 'ask', 'alice', question);
		assert.equal(adoptGuestDraft(storage, 'ask', 'alice', guestDraft), false);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, question);
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
	});

	test('expired or future guest-login markers do not authorize migration', (t) => {
		let now = 1_000_000;
		t.mock.method(Date, 'now', () => now);
		for (const delta of [15 * 60_000, 15 * 60_000 + 1, -1]) {
			const storage = new MemoryStorage();
			now = 1_000_000;
			saveDraft(storage, 'ask', '', guestDraft);
			markDraftLogin(storage, 'ask', '');
			now += delta;
			assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, emptyDraft(), `time offset ${delta}`);
			assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
		}
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

	test('malformed, outdated, oversized, or secret-bearing stored drafts are not restored', () => {
		const secret = 'oik_' + 'a'.repeat(48); // Synthetic local fixture, never a real credential.
		const cases = [
			'{bad JSON', 'null', '[]',
			JSON.stringify({ version: 2, ...question }),
			JSON.stringify({ version: 1, ...question, title: 12 }),
			JSON.stringify({ version: 1, ...question, body: { text: 'wrong type' } }),
			JSON.stringify({ version: 1, ...question, review: 'yes' }),
			JSON.stringify({ version: 1, ...question, title: 'x'.repeat(201) }),
			JSON.stringify({ version: 1, ...question, body: 'x'.repeat(4001) }),
			JSON.stringify({ version: 1, ...question, body: secret }),
		];
		for (const text of cases) {
			const storage: DraftStorage = { getItem: () => text, setItem: () => {}, removeItem: () => {} };
			assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, emptyDraft(), text.slice(0, 90));
		}
	});

	test('malformed login metadata cannot authorize guest migration', () => {
		for (const corrupt of ['{bad', 'null', '{}', JSON.stringify({ form: 'other', fromOwner: '', at: Date.now() })]) {
			const storage = new MemoryStorage();
			saveDraft(storage, 'ask', '', guestDraft);
			const prior = new Set(storage.values.keys());
			markDraftLogin(storage, 'ask', '');
			const markerKey = [...storage.values.keys()].find((k) => !prior.has(k))!;
			storage.setItem(markerKey, corrupt);
			assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, emptyDraft());
			assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
		}
	});

	test('blocked storage never throws or prevents an in-memory composer from working', () => {
		const blocked = () => { throw new Error('storage blocked'); };
		const storage: DraftStorage = { getItem: blocked, setItem: blocked, removeItem: blocked };
		assert.equal(saveDraft(storage, 'ask', 'alice', question), false);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, emptyDraft());
		assert.doesNotThrow(() => markDraftLogin(storage, 'ask', ''));
		assert.doesNotThrow(() => adoptGuestDraft(storage, 'ask', 'alice', guestDraft));
		assert.doesNotThrow(() => clearDraft(storage, 'ask', 'alice'));
	});

	test('quota failure does not destroy a prior saved owner draft', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', 'alice', question);
		storage.setItem = () => { throw new Error('quota exceeded'); };
		assert.equal(saveDraft(storage, 'ask', 'alice', guestDraft), false);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, question);
	});

	test('a readable explicit guest draft is restored in memory when migration cannot persist', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', '', guestDraft);
		markDraftLogin(storage, 'ask', '');
		storage.setItem = () => { throw new Error('quota exceeded'); };
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, guestDraft);
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
	});

	test('never persists an oik-shaped value in title or body and discards its stale saved draft', () => {
		const secret = 'oik_' + 'b'.repeat(48); // Synthetic local fixture, never a real credential.
		for (const contaminated of [{ ...question, title: secret }, { ...question, body: `A quote: ${secret}` }]) {
			const storage = new MemoryStorage();
			saveDraft(storage, 'ask', 'alice', question);
			saveDraft(storage, 'answer:1', 'alice', guestDraft);
			assert.equal(saveDraft(storage, 'ask', 'alice', contaminated), false);
			assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, emptyDraft());
			assert.deepEqual(restoreDraft(storage, 'answer:1', 'alice').draft, guestDraft);
			assert.ok(![...storage.values.values()].some((text) => text.includes(secret)));
		}
	});
});
