'use server';
// Server actions behind the site's forms.
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '../lib/db.ts';
import { approveDevice, denyDevice } from '../lib/device.ts';
import { editPost } from '../lib/edit-post.ts';
import { accept, votePost } from '../lib/forum.ts';
import { editPublicName } from '../lib/people.ts';
import { profilePath } from '../lib/public-author.ts';
import { postFeedback, type PostFeedback, type PostFormState } from '../lib/post-feedback.ts';
import { submitPostForm, type PostInput } from '../lib/post-form-submit.ts';
import { QueryError } from '../lib/query.ts';
import { COOKIE, me, safeNext } from '../lib/session.ts';
import { requireSourceCheckOrigin } from '../lib/source-check-origin.ts';
import { recordPath } from '../lib/view.ts';
import { myVotes, revokeKey, unvote, vote } from '../lib/votes.ts';

const KINDS: PostInput['kind'][] = ['question', 'answer', 'comment', 'record', 'submission'];

const signedIn = async (back: string) => (await me()) ?? redirect(`/auth/github?next=${encodeURIComponent(back)}`);

// Runs a form action and redirects back, with a QueryError's message as ?notice=.
async function thenBack(back: string, act: () => Promise<unknown>) {
	let to = back;
	try {
		await act();
	} catch (e) {
		if (!(e instanceof QueryError)) throw e;
		to = `${back}${back.includes('?') ? '&' : '?'}notice=${encodeURIComponent(e.message)}`;
	}
	redirect(to);
}

export async function savePostEdit(input: { id: number; body: string; revision: string }): Promise<{ ok: boolean; feedback?: PostFeedback }> {
	try {
		const who = await me();
		if (!who) return { ok: false, feedback: { code: 'sign_in', message: 'Sign in before saving.', fix: 'Your draft is retained. Sign in as the post owner and try again.' } };
		const saved = await editPost(await db(), input.id, { ...who, human: true }, input);
		revalidatePath(saved.record_id ? recordPath(saved.record_id) : `/forum/${saved.topic_id}`);
		if (saved.topic_id) revalidatePath('/forum');
		revalidatePath(`/u/${encodeURIComponent(who.login)}`);
		return { ok: true };
	} catch (error) {
		return { ok: false, feedback: postFeedback(error) };
	}
}

export async function sendPost(_previous: PostFormState, form: FormData): Promise<PostFormState> {
	const kind = String(form.get('kind')) as PostInput['kind'];
	if (!KINDS.includes(kind)) {
		return { status: 'failed', feedback: { code: 'bad_request', message: 'Choose a topic, reply, comment or review form.', fix: 'Open the relevant thread and try again.' } };
	}
	try {
		const who = await me();
		if (!who) return { status: 'failed', feedback: { code: 'sign_in', message: 'Sign in with GitHub before posting.', fix: 'Your draft is retained. Sign in, review it, then submit.' } };
		const retrieveSources = form.get('retrieve_sources') === 'on';
		if (kind === 'record' && retrieveSources) requireSourceCheckOrigin((await headers()).get('origin'), true);
		const location = await submitPostForm(await db(), who, {
			kind,
			title: String(form.get('title') ?? ''),
			body: String(form.get('body') ?? ''),
			topic: form.has('topic') ? Number(form.get('topic')) : undefined,
			parent: form.has('parent') ? Number(form.get('parent')) : undefined,
			record: form.has('record') ? String(form.get('record')) : undefined,
			review: form.get('review') === 'on',
			retrieveSources,
		});
		revalidatePath(location.split('#')[0]);
		if (kind === 'question') revalidatePath('/forum');
		return { status: 'posted', location };
	} catch (error) {
		return { status: 'failed', feedback: postFeedback(error) };
	}
}

/** Clicking the vote you already gave takes it back; an emoji or note you left is kept. */
export async function voteOn(form: FormData) {
	const id = String(form.get('id'));
	const value = Number(form.get('value')) === -1 ? -1 : 1;
	const back = safeNext(form.get('back'));
	const who = await signedIn(back);
	const d = await db();
	const mine = (await myVotes(d, who.login, [id])).get(id);
	await thenBack(back, () => mine?.value === value && !mine.emoji
		? unvote(d, id, who)
		: vote(d, id, who, { value: mine?.value === value ? undefined : value, emoji: mine?.emoji ?? undefined, note: mine?.note ?? undefined }));
}

/** Clicking the vote you already gave takes it back. */
export async function votePostOn(form: FormData) {
	const topic = Number(form.get('topic')), back = `/forum/${topic}`;
	const who = await signedIn(back);
	const value = Number(form.get('value')), mine = Number(form.get('mine') ?? 0);
	await thenBack(back, async () => votePost(await db(), topic, Number(form.get('post')), who, value === mine ? 0 : value));
}

export async function acceptOn(form: FormData) {
	const topic = Number(form.get('topic')), back = `/forum/${topic}`;
	const who = await signedIn(back);
	await thenBack(back, async () => accept(await db(), topic, Number(form.get('post')), who));
}

export async function signOut() {
	const jar = await cookies();
	const key = jar.get(COOKIE)?.value, who = await me();
	if (key && who) await revokeKey(await db(), who.login, { key });
	jar.delete(COOKIE);
	redirect('/');
}

export async function approve(form: FormData) {
	const code = String(form.get('code') ?? ''), back = `/keys/approve?code=${encodeURIComponent(code)}`;
	const who = await signedIn(back);
	await thenBack(back, async () => approveDevice(await db(), code, who.login));
}

export async function deny(form: FormData) {
	await signedIn('/keys');
	await denyDevice(await db(), String(form.get('code') ?? ''));
	redirect('/keys');
}

export async function dropKey(form: FormData) {
	const who = await signedIn('/keys');
	await revokeKey(await db(), who.login, { hash: String(form.get('hash')) });
	redirect('/keys');
}

/** The signed-in person's own public name and affiliation, from their profile page. */
export async function savePublicName(form: FormData) {
	const back = profilePath(String(form.get('login') ?? ''));
	const who = await signedIn(back);
	await thenBack(profilePath(who.login.toLowerCase()), async () => {
		await editPublicName(await db(), who.login, { name: form.get('name') ?? '', affiliation: form.get('affiliation') ?? '' });
		revalidatePath('/', 'layout');
	});
}
