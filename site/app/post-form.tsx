'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendPost } from './actions.ts';
import { adoptGuestDraft, clearDraft, emptyDraft, markDraftLogin, restoreDraft, saveDraft, type Draft } from '../lib/post-drafts.ts';
import { holdFeedbackText, type PostFormState } from '../lib/post-feedback.ts';
import copy from '../lib/post-copy.json';

type Props = { kind: 'question' | 'answer' | 'comment' | 'record' | 'submission'; owner: string; topic?: number; parent?: number; record?: string;
	back: string; label: string; placeholder: string; button: string; rows?: number };
const initial: PostFormState = { status: 'idle' };

export function PostForm(props: Props) {
	// A new author/thread gets new action and effect state; no old draft or success may touch that context.
	return <Composer key={JSON.stringify([props.owner, props.kind, props.record, props.topic, props.parent])} {...props} />;
}

function Composer({ kind, owner, topic, parent, record, back, label, placeholder, button, rows = 6 }: Props) {
	const router = useRouter();
	const [result, action, pending] = useActionState(sendPost, initial);
	const [draft, setDraft] = useState(emptyDraft);
	const [alternate, setAlternate] = useState<Draft>();
	const [ready, setReady] = useState(false);
	const [saved, setSaved] = useState(false);
	const formKey = `${kind}:${record ?? topic ?? 'new'}:${parent ?? 'root'}`;
	const login = `/auth/github?next=${encodeURIComponent(back)}`;
	useEffect(() => {
		try { const restored = restoreDraft(sessionStorage, formKey, owner); setDraft(restored.draft); setAlternate(restored.alternate); }
		catch { /* private browsing may block sessionStorage */ }
		setReady(true);
	}, [formKey, owner]);
	useEffect(() => {
		if (!ready) return;
		try { setSaved(saveDraft(sessionStorage, formKey, owner, draft)); } catch { setSaved(false); }
	}, [draft, formKey, owner, ready]);
	useEffect(() => {
		if (result.status !== 'posted' || !result.location) return;
		try { clearDraft(sessionStorage, formKey, owner); } catch { /* visible form still clears */ }
		setDraft(emptyDraft()); setAlternate(undefined);
		router.push(result.location); router.refresh();
	}, [result, formKey, owner, router]);
	const rememberLogin = () => {
		try { saveDraft(sessionStorage, formKey, owner, draft); markDraftLogin(sessionStorage, formKey, owner); } catch { /* keep current form */ }
	};
	const feedback = result.feedback;
	const title = feedback?.code === 'moderation_review_needed' ? copy.reviewTitle : feedback?.code === 'moderation_rejected' ? copy.revisionTitle : feedback?.code === 'moderation_unavailable' ? copy.unavailableTitle
		: feedback?.code === 'posting_unconfirmed' ? copy.serverTitle : copy.validationTitle;
	return (
		<form action={action} className="comment-form tex2jax_ignore" onSubmit={(event) => {
			if (pending) { event.preventDefault(); return; }
			if (!owner) { event.preventDefault(); rememberLogin(); window.location.assign(login); }
		}}>
			<input type="hidden" name="kind" value={kind} />
			{topic !== undefined && <input type="hidden" name="topic" value={topic} />}
			{parent !== undefined && <input type="hidden" name="parent" value={parent} />}
			{record !== undefined && <input type="hidden" name="record" value={record} />}
			<fieldset disabled={pending}>
				{kind === 'question' && <input name="title" required maxLength={200} placeholder="The question, in one line" aria-label="Title" className="grow"
					value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />}
				{kind === 'submission' ? <input name="body" required maxLength={2000} placeholder={placeholder} aria-label={label} className="grow"
					value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /> : <textarea name="body" rows={rows} maxLength={4000} required placeholder={placeholder} aria-label={label}
					value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />}
				{kind === 'submission' && <label>Supplemental research context (optional; attributed to you, unverified, used for review only)
					<textarea name="supplemental" rows={3} maxLength={2000} value={draft.supplemental ?? ''} onChange={(e) => setDraft({ ...draft, supplemental: e.target.value })} placeholder="Explain missing research description, version, attribution or provenance. Source metadata stays separate." />
				</label>}
				{kind !== 'submission' && <label><input type="checkbox" name="retrieve_sources" /> Check public sources for this post (up to twelve links; the normal posting limit applies)</label>}
				{kind === 'record' && <label><input type="checkbox" name="review" checked={draft.review} onChange={(e) => setDraft({ ...draft, review: e.target.checked })} /> This is a review</label>}
				{kind !== 'submission' && <p className="count">{copy.syntaxHelp}</p>}

				{feedback && result.status === 'failed' && <div className="post-feedback" role="alert">
					{feedback.code === 'moderation_review_needed' ? <p>{holdFeedbackText(feedback)} {feedback.fix} <a href="/support" target="_blank" rel="noopener noreferrer">Contact Support</a></p> : <><strong>{title}</strong><p>{feedback.message}</p><p>{feedback.fix}</p></>}
					{feedback.code === 'sign_in' && <a href={login} onClick={rememberLogin}>Sign in with GitHub</a>}
				</div>}
				{alternate && <button type="button" onClick={() => {
					try { if (adoptGuestDraft(sessionStorage, formKey, owner, alternate)) setDraft(alternate); } catch { /* keep visible draft */ }
					setAlternate(undefined);
				}}>{copy.restoreDraft}</button>}
				<button disabled={pending}>{pending ? copy.pending : owner ? button : `Sign in and ${button.toLowerCase()}`}</button>
				<p className="count" aria-live="polite">{!ready ? 'Drafts stay in this tab.' : saved ? copy.draftSaved : 'Your text stays in this form. Browser draft storage is unavailable.'}</p>
			</fieldset>
		</form>
	);
}
