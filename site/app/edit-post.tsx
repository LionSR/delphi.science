'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { savePostEdit } from './actions.ts';
import { clearEditDraft, readEditDraft, writeEditDraft, type EditDraft } from '#lib/posts/edit-drafts.ts';
import type { PostFeedback } from '#lib/posts/feedback.ts';
import { PostFeedbackText } from './post-feedback.tsx';
import { MAX_BODY } from '#lib/posts/limits.ts';

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
			setFeedback({ code: 'editing_unconfirmed', message: 'Saving could not be confirmed.', fix: 'Your draft is kept. Check the current post before trying again.' });
		} finally {
			saving.current = false;
			setPending(false);
		}
	};

	if (!editing) return <button className="link" onClick={open}>Edit</button>;
	return <form className="comment-form tex2jax_ignore" onSubmit={save}>
		<fieldset disabled={pending}>
			<textarea autoFocus aria-label="Edit post" required maxLength={MAX_BODY} rows={6} value={draft.body} onChange={e => remember({ ...draft, body: e.target.value })} />
			{feedback && <div role="alert"><PostFeedbackText feedback={feedback} /></div>}
			{draft.revision !== revision && <p role="status">The post has changed since this draft. Cancel to start again from the current text.</p>}
			<div className="edit-actions">
				<button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
				<button type="button" disabled={pending} onClick={cancel}>Cancel</button>
			</div>
		</fieldset>
	</form>;
}
