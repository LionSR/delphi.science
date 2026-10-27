'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendPost } from './actions.ts';
import { SourceChecks } from './source-checks.tsx';
import { adoptGuestDraft, clearDraft, emptyDraft, markDraftLogin, restoreDraft, saveDraft, type Draft } from '../lib/post-drafts.ts';
import type { PostFormState } from '../lib/post-feedback.ts';
import copy from '../lib/post-copy.json';
import { draftSourceUrls } from '../lib/source-check-batches.ts';

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
	const [checkingSources, setCheckingSources] = useState(false);
	// Retrieval consent is intentionally separate from the persisted draft and starts unchecked.
	const [retrieveSources, setRetrieveSources] = useState(false);
	const sourceSignature = draftSourceUrls(draft.body).join('\n');
	useEffect(() => { setRetrieveSources(false); }, [sourceSignature]);
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
		setDraft(emptyDraft()); setAlternate(undefined); setRetrieveSources(false);
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
			if (pending || checkingSources) { event.preventDefault(); return; }
			if (!owner) { event.preventDefault(); rememberLogin(); window.location.assign(login); }
		}}>
			<input type="hidden" name="kind" value={kind} />
			{topic !== undefined && <input type="hidden" name="topic" value={topic} />}
			{parent !== undefined && <input type="hidden" name="parent" value={parent} />}
			{record !== undefined && <input type="hidden" name="record" value={record} />}
			<fieldset disabled={pending || checkingSources}>
				{kind === 'question' && <input name="title" required maxLength={200} placeholder="The question, in one line" aria-label="Title" className="grow"
					value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />}
				{kind === 'submission' ? <input name="body" required maxLength={2000} placeholder={placeholder} aria-label={label} className="grow"
					value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /> : <textarea name="body" rows={rows} maxLength={4000} required placeholder={placeholder} aria-label={label}
					value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />}
				{kind === 'record' && <label><input type="checkbox" name="review" checked={draft.review} onChange={(e) => setDraft({ ...draft, review: e.target.checked })} /> This is a review</label>}
				{kind !== 'submission' && <p className="count">{copy.syntaxHelp}</p>}
				{kind === 'record' && record && <>
					<SourceChecks record={record} owner={owner} draft={draft.body} disabled={pending} onBusyChange={setCheckingSources}
						onSignIn={() => { rememberLogin(); window.location.assign(login); }} />
					<label><input type="checkbox" name="retrieve_sources" checked={retrieveSources} onChange={(event)=>setRetrieveSources(event.target.checked)} /> Request fresh public retrieval when I submit</label>
					<p className="count">Leave unchecked to use existing indexed metadata or explicitly dated, operator-reviewed observations. A fresh retrieval failure stays on hold; it cannot fall back to an older observation.</p>
				</>}
				{feedback && result.status === 'failed' && <div className="post-feedback" role="alert">
					<strong>{title}</strong><p>{feedback.message}</p><p>{feedback.fix}</p>
					{feedback.code === 'sign_in' && <a href={login} onClick={rememberLogin}>Sign in with GitHub</a>}
				</div>}
				{alternate && <button type="button" onClick={() => {
					try { if (adoptGuestDraft(sessionStorage, formKey, owner, alternate)) setDraft(alternate); } catch { /* keep visible draft */ }
					setAlternate(undefined);
				}}>{copy.restoreDraft}</button>}
				<button disabled={pending || checkingSources}>{pending ? copy.pending : owner ? button : `Sign in and ${button.toLowerCase()}`}</button>
				<p className="count" aria-live="polite">{!ready ? 'Drafts stay in this tab.' : saved ? copy.draftSaved : 'Your text stays in this form. Browser draft storage is unavailable.'}</p>
			</fieldset>
		</form>
	);
}
