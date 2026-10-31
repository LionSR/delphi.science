import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
	adoptGuestDraft, clearDraft, emptyDraft, markDraftLogin, restoreDraft, saveDraft,
	type Draft, type DraftStorage,
} from './post-drafts.ts';

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
	test('each empty draft is independent', () => {
		const a = emptyDraft(), b = emptyDraft();
		a.body = 'An unsaved edit';
		assert.deepEqual(b, { title: '', body: '', review: false });
		assert.deepEqual(restoreDraft(new MemoryStorage(), 'ask', 'alice'), { draft: b });
	});

	test('rejected and service-failed attempts retain exact drafts across reads and revisions', () => {
		const storage = new MemoryStorage();
		assert.equal(saveDraft(storage, 'ask', 'alice', question), true);
		// The form owns posting outcomes. A refusal/failure must not invoke clearDraft.
		for (const outcome of ['moderation_rejected', 'moderation_unavailable', 'posting_unconfirmed']) {
			assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, question, outcome);
		}
		const revised = { ...question, body: question.body + '\nI am considering the finite open-chain identity only.' };
		assert.equal(saveDraft(storage, 'ask', 'alice', revised), true);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, revised);
	});

	test('isolates author, form, topic, and parent drafts', () => {
		const storage = new MemoryStorage();
		const cases: [string, string, Draft][] = [
			['ask', 'alice', question],
			['ask', 'bob', draft('Bob’s separate question.')],
			['answer:1', 'alice', draft('An answer to topic one.')],
			['answer:2', 'alice', draft('An answer to topic two.')],
			['comment:1:6', 'alice', draft('A comment on post six.')],
			['comment:1:7', 'alice', draft('A comment on post seven.')],
			['review:record/one', 'alice', { ...draft('A specific review.'), review: true }],
		];
		for (const [form, owner, d] of cases) assert.equal(saveDraft(storage, form, owner, d), true);
		for (const [form, owner, d] of cases) assert.deepEqual(restoreDraft(storage, form, owner).draft, d);
		assert.deepEqual(restoreDraft(storage, 'answer:3', 'alice').draft, emptyDraft());
		assert.deepEqual(restoreDraft(storage, 'ask', 'carol').draft, emptyDraft());
	});

	test('does not confuse separator-like characters in owner and form names', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'b:c/%', 'a', question);
		saveDraft(storage, 'c/%', 'a:b', guestDraft);
		assert.deepEqual(restoreDraft(storage, 'b:c/%', 'a').draft, question);
		assert.deepEqual(restoreDraft(storage, 'c/%', 'a:b').draft, guestDraft);
	});

	test('an authenticated owner named guest is distinct from an anonymous author', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', '', guestDraft);
		saveDraft(storage, 'ask', 'guest', question);
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
		assert.deepEqual(restoreDraft(storage, 'ask', 'guest').draft, question);
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

	test('prefers an existing owner draft and offers the explicitly carried guest draft separately', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', '', guestDraft);
		saveDraft(storage, 'ask', 'alice', question);
		markDraftLogin(storage, 'ask', '');
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: question, alternate: guestDraft });
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
		assert.equal(adoptGuestDraft(storage, 'ask', 'alice', guestDraft), true);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: guestDraft });
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, emptyDraft());
	});

	test('an offered guest alternate cannot migrate to another account without a new login intent', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', '', guestDraft);
		saveDraft(storage, 'ask', 'alice', question);
		markDraftLogin(storage, 'ask', '');
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: question, alternate: guestDraft });
		assert.deepEqual(restoreDraft(storage, 'ask', 'bob'), { draft: emptyDraft() });
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, question);
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

	test('an alternate bound to one authenticated owner cannot be adopted by another', () => {
		const storage = new MemoryStorage();
		const bobsDraft = draft('Bob’s independent draft.');
		saveDraft(storage, 'ask', '', guestDraft);
		saveDraft(storage, 'ask', 'alice', question);
		saveDraft(storage, 'ask', 'bob', bobsDraft);
		markDraftLogin(storage, 'ask', '');
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice'), { draft: question, alternate: guestDraft });
		assert.equal(adoptGuestDraft(storage, 'ask', 'bob', guestDraft), false);
		assert.deepEqual(restoreDraft(storage, 'ask', 'bob').draft, bobsDraft);
		assert.deepEqual(restoreDraft(storage, 'ask', '').draft, guestDraft);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, question);
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

	test('explicit clearing after a confirmed post removes only that owner’s form', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', 'alice', question);
		saveDraft(storage, 'ask', 'bob', guestDraft);
		saveDraft(storage, 'comment:1:6', 'alice', guestDraft);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, question);
		clearDraft(storage, 'ask', 'alice');
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, emptyDraft());
		assert.deepEqual(restoreDraft(storage, 'ask', 'bob').draft, guestDraft);
		assert.deepEqual(restoreDraft(storage, 'comment:1:6', 'alice').draft, guestDraft);
	});

	test('saving an intentionally emptied form clears it without touching another form', () => {
		const storage = new MemoryStorage();
		saveDraft(storage, 'ask', 'alice', question);
		saveDraft(storage, 'answer:1', 'alice', guestDraft);
		assert.equal(saveDraft(storage, 'ask', 'alice', emptyDraft()), true);
		assert.deepEqual(restoreDraft(storage, 'ask', 'alice').draft, emptyDraft());
		assert.deepEqual(restoreDraft(storage, 'answer:1', 'alice').draft, guestDraft);
	});

	test('review selection is part of the draft even when text is temporarily empty', () => {
		const storage = new MemoryStorage();
		const review = { ...emptyDraft(), review: true };
		saveDraft(storage, 'record:one', 'alice', review);
		assert.deepEqual(restoreDraft(storage, 'record:one', 'alice').draft, review);
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
		assert.deepEqual(question, draft('For an open chain the telescoping sum leaves endpoint terms.', 'Which boundary conditions are assumed?'));
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

 test('submission URLs retain their own author-scoped draft through refusal and resubmission', () => {
	const storage = new MemoryStorage(), url = draft('arXiv:1706.03762');
	assert.equal(saveDraft(storage, 'submission:new:root', 'alice', url), true);
	assert.deepEqual(restoreDraft(storage, 'submission:new:root', 'alice').draft, url);
	assert.deepEqual(restoreDraft(storage, 'submission:new:root', 'bob').draft, emptyDraft());
	clearDraft(storage, 'submission:new:root', 'alice');
	assert.deepEqual(restoreDraft(storage, 'submission:new:root', 'alice').draft, emptyDraft());
});


test('supplemental submission context survives refusal without leaking across accounts or retaining keys', () => {
 const storage = new MemoryStorage();
 const d = { ...draft('lab/new-research'), supplemental: 'A finite-chain reproduction; version 1.' };
 assert.equal(saveDraft(storage, 'submission:new:root', 'alice', d), true);
 assert.deepEqual(restoreDraft(storage, 'submission:new:root', 'alice').draft, d);
 assert.deepEqual(restoreDraft(storage, 'submission:new:root', 'bob').draft, emptyDraft());
 assert.equal(saveDraft(storage, 'submission:new:root', 'alice', { ...d, supplemental: 'oik_' + 'a'.repeat(48) }), false);
 assert.deepEqual(restoreDraft(storage, 'submission:new:root', 'alice').draft, emptyDraft());
});
