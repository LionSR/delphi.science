// Post drafts kept in tab storage, per author and form. A guest's draft can carry over when they sign in.
import { SECTION_IDS, type Section } from './sections.ts';
import { MAX_BODY } from './limits.ts';
export type Draft = { title: string; body: string; review: boolean; section?: Section };
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Whether text contains an agent key; such drafts are never stored. */
export const hasKey = (text: string) => /oik_[0-9a-f]{48}/.test(text);

const key = (form: string, owner: string) => `ori:post-draft:v1:${owner ? `user:${encodeURIComponent(owner)}` : 'anon'}:${encodeURIComponent(form)}`;
const loginKey = (form: string) => `ori:post-login:v1:${encodeURIComponent(form)}`;
const LOGIN_WINDOW = 15 * 60_000;
export const emptyDraft = (): Draft => ({ title: '', body: '', review: false });

function read(storage: DraftStorage, form: string, owner: string): Draft | undefined {
	try {
		const d = JSON.parse(storage.getItem(key(form, owner)) || 'null');
		if (d?.version !== 1 || typeof d.title !== 'string' || d.title.length > 200 || typeof d.body !== 'string'
			|| d.body.length > MAX_BODY || typeof d.review !== 'boolean' || hasKey(d.title + d.body)) return undefined;
		return { title: d.title, body: d.body, review: d.review, ...(SECTION_IDS.includes(d.section) ? { section: d.section } : {}) };
	} catch {
		return undefined;
	}
}

type Marker = { form: string; fromOwner: string; toOwner?: string; at: number };

/** The guest's recent sign-in marker for this form, if any. May throw on malformed storage. */
function guestMarker(storage: DraftStorage, form: string): Marker | undefined {
	const m = JSON.parse(storage.getItem(loginKey(form)) || 'null');
	if (m?.form !== form || m.fromOwner !== '' || typeof m.at !== 'number') return undefined;
	const age = Date.now() - m.at;
	return age >= 0 && age < LOGIN_WINDOW ? m : undefined;
}

export function saveDraft(storage: DraftStorage, form: string, owner: string, draft: Draft): boolean {
	try {
		if (hasKey(draft.title + draft.body)) {
			storage.removeItem(key(form, owner));
			return false;
		}
		if (!draft.title && !draft.body && !draft.review) storage.removeItem(key(form, owner));
		else storage.setItem(key(form, owner), JSON.stringify({ version: 1, ...draft }));
		return true;
	} catch {
		return false;
	}
}

/** Call only when the author deliberately starts sign-in from this form. */
export function markDraftLogin(storage: DraftStorage, form: string, owner: string): void {
	try {
		storage.setItem(loginKey(form), JSON.stringify({ form, fromOwner: owner, at: Date.now() }));
	} catch { /* the in-memory draft still works */ }
}

export function restoreDraft(storage: DraftStorage, form: string, owner: string): { draft: Draft; alternate?: Draft } {
	const own = read(storage, form, owner);
	try {
		const marker = owner ? guestMarker(storage, form) : undefined;
		if (marker) {
			const guest = read(storage, form, '');
			if (!marker.toOwner) {
				// Claim the marker for this owner, so no other account can take the guest draft.
				marker.toOwner = owner;
				try {
					storage.setItem(loginKey(form), JSON.stringify(marker));
				} catch {
					// A full quota may still allow removal: drop the marker and keep the draft in memory only.
					storage.removeItem(loginKey(form));
					return { draft: own ?? guest ?? emptyDraft() };
				}
			}
			// If the owner already has a draft, the guest draft is only offered, and the marker is kept so the owner can adopt it.
			if (marker.toOwner === owner && guest) {
				if (own) return { draft: own, alternate: guest };
				if (saveDraft(storage, form, owner, guest)) storage.removeItem(key(form, ''));
				storage.removeItem(loginKey(form));
				return { draft: guest };
			}
		}
		// Any other marker is dropped: one claimed by another account, set by a signed-in author, or with no guest draft left.
		if (owner) storage.removeItem(loginKey(form));
	} catch { /* storage problems never block composing */ }
	return { draft: own ?? emptyDraft() };
}

export function adoptGuestDraft(storage: DraftStorage, form: string, owner: string, draft: Draft): boolean {
	try {
		const marker = guestMarker(storage, form);
		if (!owner || !marker || marker.toOwner !== owner) return false;
		if (!saveDraft(storage, form, owner, draft)) return false;
		storage.removeItem(key(form, ''));
		storage.removeItem(loginKey(form));
		return true;
	} catch {
		return false;
	}
}

export function clearDraft(storage: DraftStorage, form: string, owner: string): void {
	try {
		storage.removeItem(key(form, owner));
		storage.removeItem(loginKey(form));
	} catch { /* nothing else to clear */ }
}
