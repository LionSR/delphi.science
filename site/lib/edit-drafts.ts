import type { DraftStorage } from './post-drafts.ts';

export type EditDraft = { body: string; revision: string };
const key = (owner: string, id: number) => `ori:edit-draft:v1:${encodeURIComponent(owner)}:${id}`;
export function readEditDraft(storage: DraftStorage, owner: string, id: number): EditDraft | undefined {
	try {
		const d = JSON.parse(storage.getItem(key(owner, id)) || 'null');
		if (typeof d?.body === 'string' && d.body.length <= 4000 && !/oik_[0-9a-f]{48}/.test(d.body) && typeof d.revision === 'string' && /^\d+$/.test(d.revision)) return { body: d.body, revision: d.revision };
	} catch { /* retain the visible editor if storage is unavailable */ }
}
export function writeEditDraft(storage: DraftStorage, owner: string, id: number, draft: EditDraft) {
	try {
		if (/oik_[0-9a-f]{48}/.test(draft.body)) storage.removeItem(key(owner, id));
		else storage.setItem(key(owner, id), JSON.stringify(draft));
	} catch { /* retain the visible editor if storage is unavailable */ }
}
export function clearEditDraft(storage: DraftStorage, owner: string, id: number) {
	try { storage.removeItem(key(owner, id)); } catch { /* visible state still resets */ }
}
