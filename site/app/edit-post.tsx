'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { savePostEdit } from './actions.ts';
import { clearEditDraft, readEditDraft, writeEditDraft, type EditDraft } from '../lib/edit-drafts.ts';
import { holdFeedbackText, type PostFeedback } from '../lib/post-feedback.ts';

// sessionStorage can be unavailable; the draft then lives only in component state.
function stored<T>(use: () => T): T | undefined {
	try { return use(); } catch { return undefined; }
}

export function EditPost({ id, owner, body, revision }: { id: number; owner: string; body: string; revision: string }) {
	const router = useRouter();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState<EditDraft>({ body, revision });
	const [feedback, setFeedback] = useState<PostFeedback>();
	const [pending, setPending] = useState(false);
	const saving = useRef(false);

	const remember = (value: EditDraft) => {
		setDraft(value);
		stored(() => writeEditDraft(sessionStorage, owner, id, value));
	};
	const close = () => {
		stored(() => clearEditDraft(sessionStorage, owner, id));
		setEditing(false);
	};
	const open = () => {
		setDraft(stored(() => readEditDraft(sessionStorage, owner, id)) ?? { body, revision });
		setFeedback(undefined);
		setEditing(true);
	};
	const cancel = () => {
		close();
		setDraft({ body, revision });
		setFeedback(undefined);
	};
	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (saving.current) return;
		// Feedback stays in place while saving, so a repeated click cannot land on a link beneath the form.
		saving.current = true;
		setPending(true);
		try {
			const result = await savePostEdit({ id, ...draft });
			if (result.ok) {
				close();
				router.refresh();
			} else setFeedback(result.feedback);
		} catch {
			setFeedback({ code: 'editing_unconfirmed', message: 'Saving could not be confirmed.', fix: 'Your draft is retained. Check the current post before trying again.' });
		} finally {
			saving.current = false;
			setPending(false);
		}
	};

	if (!editing) return <button className="link" onClick={open}>Edit</button>;
	return <form className="comment-form tex2jax_ignore" onSubmit={save}>
		<fieldset disabled={pending}>
			<textarea autoFocus aria-label="Edit post" required maxLength={4000} rows={6} value={draft.body} onChange={e => remember({ ...draft, body: e.target.value })} />
			{feedback && <div role="alert">{feedback.code === 'moderation_review_needed'
				? <p>{holdFeedbackText(feedback)} <a href="/support" target="_blank" rel="noopener noreferrer">Contact Support</a></p>
				: <><p>{feedback.message}</p><p>{feedback.fix}</p></>}</div>}
			{draft.revision !== revision && <p role="status">The post has changed since this draft. Cancel to start again from the current text.</p>}
			<div className="edit-actions">
				<button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
				<button type="button" disabled={pending} onClick={cancel}>Cancel</button>
			</div>
		</fieldset>
	</form>;
}
