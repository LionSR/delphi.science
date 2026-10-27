'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { savePostEdit } from './actions.ts';
import { clearEditDraft, readEditDraft, writeEditDraft, type EditDraft } from '../lib/edit-drafts.ts';
import type { PostFeedback } from '../lib/post-feedback.ts';

export function EditPost({ id, owner, body, revision }: { id: number; owner: string; body: string; revision: string }) {
	const router = useRouter();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<EditDraft>({ body, revision });
	const [feedback, setFeedback] = useState<PostFeedback>();
	const [pending, setPending] = useState(false);
	const saving = useRef(false);
	const remember = (value: EditDraft) => { setDraft(value); try { writeEditDraft(sessionStorage, owner, id, value); } catch { /* memory draft remains */ } };
	if (!editing) return <button className="link" onClick={() => {
		let restored: EditDraft | undefined;
		try { restored = readEditDraft(sessionStorage, owner, id); } catch { /* use public body */ }
		setDraft(restored ?? { body, revision }); setFeedback(undefined); setEditing(true);
	}}>Edit</button>;
	return <form className="comment-form tex2jax_ignore" onSubmit={async event => {
		event.preventDefault();
		if (saving.current) return;
		saving.current = true; setPending(true); setFeedback(undefined);
		try {
			const result = await savePostEdit({ id, ...draft });
			if (result.ok) {
				try { clearEditDraft(sessionStorage, owner, id); } catch { /* close visible editor */ }
				setEditing(false); router.refresh();
			} else setFeedback(result.feedback);
		} catch { setFeedback({ code: 'editing_unconfirmed', message: 'Saving could not be confirmed.', fix: 'Your draft is retained. Check the current post before trying again.' }); }
		finally { saving.current = false; setPending(false); }
	}}>
		<fieldset disabled={pending}>
			<textarea autoFocus aria-label="Edit post" required maxLength={4000} rows={6} value={draft.body} onChange={e => remember({ ...draft, body: e.target.value })} />
			{feedback && <div role="alert"><p>{feedback.message}</p><p>{feedback.fix}</p></div>}
			{draft.revision !== revision && <p role="status">The post has changed since this draft. Cancel to start again from the current text.</p>}
			<div className="edit-actions"><button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
			<button type="button" disabled={pending} onClick={() => {
				try { clearEditDraft(sessionStorage, owner, id); } catch { /* close visible editor */ }
				setDraft({ body, revision }); setFeedback(undefined); setEditing(false);
			}}>Cancel</button></div>
		</fieldset>
	</form>;
}
