import { hasKey, type DraftStorage } from './post-drafts.ts';

export type EditDraft = { body: string; revision: string };
const key = (owner: string, id: number) => `ori:edit-draft:v1:${encodeURIComponent(owner)}:${id}`;

export function readEditDraft(storage: DraftStorage, owner: string, id: number): EditDraft | undefined {
	try {
		const d = JSON.parse(storage.getItem(key(owner, id)) || 'null');
		if (typeof d?.body === 'string' && d.body.length <= 4000 && !hasKey(d.body) && typeof d.revision === 'string' && /^\d+$/.test(d.revision)) {
			return { body: d.body, revision: d.revision };
		}
	} catch { /* storage unavailable: the editor keeps its visible text */ }
	return undefined;
}

export function writeEditDraft(storage: DraftStorage, owner: string, id: number, draft: EditDraft) {
	try {
		if (hasKey(draft.body)) storage.removeItem(key(owner, id));
		else storage.setItem(key(owner, id), JSON.stringify(draft));
	} catch { /* storage unavailable: the editor keeps its visible text */ }
}

export function clearEditDraft(storage: DraftStorage, owner: string, id: number) {
	try {
		storage.removeItem(key(owner, id));
	} catch { /* storage unavailable */ }
}
