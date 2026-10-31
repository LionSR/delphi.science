// Drafts stay in this tab, scoped to an author and one form/topic/parent. Never store keys or send drafts in URLs.
export type Draft = { title: string; body: string; review: boolean; supplemental?: string };
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (form: string, owner: string) => `ori:post-draft:v1:${owner ? `user:${encodeURIComponent(owner)}` : 'anon'}:${encodeURIComponent(form)}`;
const loginKey = (form: string) => `ori:post-login:v1:${encodeURIComponent(form)}`;
export const emptyDraft = (): Draft => ({ title: '', body: '', review: false });

function read(storage: DraftStorage, form: string, owner: string): Draft | undefined {
	try {
		const d = JSON.parse(storage.getItem(key(form, owner)) || 'null');
		if (d?.version !== 1 || typeof d.title !== 'string' || d.title.length > 200 || typeof d.body !== 'string'
			|| d.body.length > 4000 || typeof d.review !== 'boolean' || (d.supplemental !== undefined && (typeof d.supplemental !== 'string' || d.supplemental.length > 2000)) || /oik_[0-9a-f]{48}/.test(d.title + d.body + (d.supplemental ?? ''))) return;
		return { title: d.title, body: d.body, review: d.review, ...(d.supplemental ? { supplemental: d.supplemental } : {}) };
	} catch { return; }
}

export function saveDraft(storage: DraftStorage, form: string, owner: string, draft: Draft): boolean {
	try {
		if (/oik_[0-9a-f]{48}/.test(draft.title + draft.body + (draft.supplemental ?? ''))) { storage.removeItem(key(form, owner)); return false; }
		if (!draft.title && !draft.body && !draft.review && !draft.supplemental) storage.removeItem(key(form, owner));
		else storage.setItem(key(form, owner), JSON.stringify({ version: 1, ...draft }));
		return true;
	} catch { return false; }
}

/** Call only when the author intentionally starts sign-in for this particular form. */
export function markDraftLogin(storage: DraftStorage, form: string, owner: string): void {
	try { storage.setItem(loginKey(form), JSON.stringify({ form, fromOwner: owner, at: Date.now() })); } catch { /* memory draft still works */ }
}

export function restoreDraft(storage: DraftStorage, form: string, owner: string): { draft: Draft; alternate?: Draft } {
	const own = read(storage, form, owner);
	try {
		const marker = JSON.parse(storage.getItem(loginKey(form)) || 'null');
		if (owner && marker?.form === form && marker.fromOwner === '' && typeof marker.at === 'number'
			&& Date.now() - marker.at >= 0 && Date.now() - marker.at < 15 * 60_000) {
			const guest = read(storage, form, '');
			if (!marker.toOwner) {
				marker.toOwner = owner;
				try { storage.setItem(loginKey(form), JSON.stringify(marker)); }
				catch {
					// Quota exhaustion can still permit removal: consume the intent before showing a memory-only draft.
					storage.removeItem(loginKey(form));
					return { draft: own ?? guest ?? emptyDraft() };
				}
			}
			if (marker.toOwner !== owner) { storage.removeItem(loginKey(form)); return { draft: own ?? emptyDraft() }; }
			if (guest && own) return { draft: own, alternate: guest };
			if (guest) {
				if (saveDraft(storage, form, owner, guest)) storage.removeItem(key(form, ''));
				storage.removeItem(loginKey(form)); return { draft: guest };
			}
		}
		if (owner) storage.removeItem(loginKey(form));
	} catch { /* blocked or malformed storage never prevents composing */ }
	return { draft: own ?? emptyDraft() };
}

export function adoptGuestDraft(storage: DraftStorage, form: string, owner: string, draft: Draft): boolean {
	try {
		const marker = JSON.parse(storage.getItem(loginKey(form)) || 'null');
		if (!owner || marker?.form !== form || marker.fromOwner !== '' || marker.toOwner !== owner
			|| typeof marker.at !== 'number' || Date.now() - marker.at < 0 || Date.now() - marker.at >= 15 * 60_000) return false;
		if (!saveDraft(storage, form, owner, draft)) return false;
		storage.removeItem(key(form, '')); storage.removeItem(loginKey(form)); return true;
	} catch { return false; }
}

export function clearDraft(storage: DraftStorage, form: string, owner: string): void {
	try { storage.removeItem(key(form, owner)); storage.removeItem(loginKey(form)); } catch { /* never clear another form/owner */ }
}
