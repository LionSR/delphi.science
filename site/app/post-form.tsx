'use client';

import { SECTIONS, SECTION_IDS, type Section } from '#lib/posts/sections.ts';
import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendPost } from './actions.ts';
import { adoptGuestDraft, clearDraft, emptyDraft, markDraftLogin, restoreDraft, saveDraft, type Draft } from '#lib/posts/drafts.ts';
import type { PostFormState } from '#lib/posts/feedback.ts';
import type { PostInput } from '#lib/posts/form-submit.ts';
import copy from '#lib/posts/copy.json';
import { PostFeedbackText } from './post-feedback.tsx';
import { MAX_BODY } from '#lib/posts/limits.ts';

type Props = { kind: PostInput['kind']; owner: string; topic?: number; parent?: number; record?: string; space?: string;
	/** Shows the forum's section choice on a new topic, starting at this one. */
	section?: Section;
	back: string; label: string; placeholder: string; button: string; rows?: number };
const initial: PostFormState = { status: 'idle' };
// A held post (moderation_review_needed) shows its reason instead of a title.
const TITLES: Record<string, string> = {
	moderation_rejected: copy.revisionTitle,
	moderation_unavailable: copy.unavailableTitle,
	posting_unconfirmed: copy.serverTitle,
};

export function PostForm(props: Props) {
	// Remount for a new author or thread so no draft or result carries over.
	return <Composer key={JSON.stringify([props.owner, props.kind, props.record, props.topic, props.parent, props.space, props.section])} {...props} />;
}

function Composer({ kind, owner, topic, parent, record, space, section, back, label, placeholder, button, rows = 6 }: Props) {
	const router = useRouter();
	const [result, action, pending] = useActionState(sendPost, initial);
	// A form sent without JavaScript is drawn again by the server: a post that failed keeps its text.
	const [draft, setDraft] = useState<Draft>(() => result.draft ?? emptyDraft());
	const [alternate, setAlternate] = useState<Draft>();
	const [ready, setReady] = useState(false);
	const [saved, setSaved] = useState(false);
	// A space's new-topic draft is its own; the forum's keeps the key it always had.
	const formKey = `${kind}:${record ?? topic ?? (space ? `new@${space}` : 'new')}:${parent ?? 'root'}${section && section !== 'general' ? `:${section}` : ''}`;
	const login = `/auth/github?next=${encodeURIComponent(back)}`;
	useEffect(() => {
		try {
			const restored = restoreDraft(sessionStorage, formKey, owner);
			setDraft(restored.draft);
			setAlternate(restored.alternate);
		} catch { /* sessionStorage may be blocked */ }
		setReady(true);
	}, [formKey, owner]);
	useEffect(() => {
		if (!ready) return;
		try { setSaved(saveDraft(sessionStorage, formKey, owner, draft)); } catch { setSaved(false); }
	}, [draft, formKey, owner, ready]);
	useEffect(() => {
		if (result.status !== 'posted' || !result.location) return;
		try { clearDraft(sessionStorage, formKey, owner); } catch { /* visible form still clears */ }
		setDraft(emptyDraft());
		setAlternate(undefined);
		router.push(result.location);
		router.refresh();
	}, [result, formKey, owner, router]);
	const rememberLogin = () => {
		try {
			saveDraft(sessionStorage, formKey, owner, draft);
			markDraftLogin(sessionStorage, formKey, owner);
		} catch { /* keep current form */ }
	};
	const feedback = result.feedback;
	return (
		<form action={action} className="comment-form tex2jax_ignore" onSubmit={(event) => {
			if (pending) { event.preventDefault(); return; }
			if (!owner) { event.preventDefault(); rememberLogin(); window.location.assign(login); }
		}}>
			<input type="hidden" name="kind" value={kind} />
			{topic !== undefined && <input type="hidden" name="topic" value={topic} />}
			{parent !== undefined && <input type="hidden" name="parent" value={parent} />}
			{record !== undefined && <input type="hidden" name="record" value={record} />}
			{space !== undefined && <input type="hidden" name="space" value={space} />}
			<fieldset disabled={pending}>
				{kind === 'question' && section && <label>Section <select name="section" value={draft.section ?? section}
					onChange={(e) => setDraft({ ...draft, section: e.target.value as Section })}>
					{SECTION_IDS.map((id) => <option key={id} value={id}>{SECTIONS[id]}</option>)}
				</select></label>}
				{kind === 'question' && <input name="title" required maxLength={200} placeholder="The question or topic, in one line" aria-label="Title" className="grow"
					value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />}
				{kind === 'submission' ? <input name="body" required maxLength={2000} placeholder={placeholder} aria-label={label} className="grow"
					value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /> : <textarea name="body" rows={rows} maxLength={MAX_BODY} required placeholder={placeholder} aria-label={label}
					value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />}
				{kind === 'record' && <label><input type="checkbox" name="review" checked={draft.review} onChange={(e) => setDraft({ ...draft, review: e.target.checked })} /> This is a review</label>}
				{kind !== 'submission' && <p className="count">{copy.syntaxHelp}</p>}

				{feedback && result.status === 'failed' && <div className="post-feedback" role="alert">
					<PostFeedbackText feedback={feedback} title={TITLES[feedback.code] ?? copy.validationTitle} />
					{feedback.code === 'sign_in' && <a href={login} onClick={rememberLogin}>Sign in with GitHub</a>}
				</div>}
				{/* With JavaScript the page moves to the post at once; without it, this says where it is. */}
				{result.status === 'posted' && result.location && <p className="count" role="status">Posted. <a href={result.location}>Open it</a>.</p>}
				{alternate && <button type="button" onClick={() => {
					try { if (adoptGuestDraft(sessionStorage, formKey, owner, alternate)) setDraft(alternate); } catch { /* keep visible draft */ }
					setAlternate(undefined);
				}}>{copy.restoreDraft}</button>}
				<button disabled={pending}>{pending ? copy.pending : owner ? button : `Sign in and ${button.toLowerCase()}`}</button>
				{ready && (draft.title || draft.body) && (
					<p className="count" aria-live="polite">{saved ? copy.draftSaved : 'Draft stays in this form while open.'}</p>
				)}
			</fieldset>
		</form>
	);
}
