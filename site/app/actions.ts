'use server';
// Server actions behind the site's forms.
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '#lib/db.ts';
import { approveDevice, denyDevice } from '#lib/accounts/device.ts';
import { authorizeRequest, issueCode, redirectBack } from '#lib/accounts/oauth.ts';
import { editPost } from '#lib/posts/edit.ts';
import { accept, votePost } from '#lib/posts/forum.ts';
import { post } from '#lib/posts/comments.ts';
import { addMember, createSpace, deleteSpace, removeMember, topicPath } from '#lib/posts/spaces.ts';
import { FORUM } from '#lib/posts/visibility.ts';
import { editPublicName } from '#lib/accounts/people.ts';
import { profilePath } from '#lib/accounts/public-author.ts';
import { postFeedback, type PostFeedback, type PostFormState } from '#lib/posts/feedback.ts';
import { FORM_KINDS, type PostInput, submitPostForm } from '#lib/posts/form-submit.ts';
import { QueryError } from '#lib/errors.ts';
import { COOKIE, me, safeNext, signedIn } from '#lib/accounts/session.ts';
import { requireSourceCheckOrigin } from '#lib/moderation/source-check-origin.ts';
import { recordPath } from '#lib/view.ts';
import { myVotes, unvote, vote } from '#lib/records/votes.ts';
import { createSession, revokeAgentKey, revokeKey } from '#lib/accounts/keys.ts';
import { isReviewer, reviewLogin } from '#lib/accounts/review.ts';


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
		if (!who) return { ok: false, feedback: { code: 'sign_in', message: 'Sign in before saving.', fix: 'Your draft is kept. Sign in as the post owner and try again.' } };
		const saved = await editPost(await db(), input.id, who, input);
		revalidatePath(saved.record_id ? recordPath(saved.record_id) : `/${topicPath(saved.space ?? FORUM, saved.topic_id!)}`);
		if (saved.topic_id && saved.space === FORUM) revalidatePath('/forum');
		revalidatePath(`/u/${encodeURIComponent(who.login)}`);
		return { ok: true };
	} catch (error) {
		return { ok: false, feedback: postFeedback(error) };
	}
}

export async function sendPost(_previous: PostFormState, form: FormData): Promise<PostFormState> {
	const kind = String(form.get('kind')) as PostInput['kind'];
	// What was sent, to fill the form again if it is not posted: without JavaScript the page is all the author has.
	const draft = { title: String(form.get('title') ?? ''), body: String(form.get('body') ?? ''), review: form.get('review') === 'on' };
	if (!(FORM_KINDS as readonly string[]).includes(kind)) {
		return { status: 'failed', feedback: { code: 'bad_request', message: 'Choose a topic, reply, comment or review form.', fix: 'Open the relevant thread and try again.' } };
	}
	try {
		const who = await me();
		if (!who) return { status: 'failed', draft, feedback: { code: 'sign_in', message: 'Sign in with GitHub before posting.', fix: 'Your draft is kept. Sign in, review it, then submit.' } };
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
			space: form.has('space') ? String(form.get('space')) : undefined,
		});
		revalidatePath(location.split('#')[0]);
		if (kind === 'question' && !form.has('space')) revalidatePath('/forum');
		return { status: 'posted', location };
	} catch (error) {
		return { status: 'failed', draft, feedback: postFeedback(error) };
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
	await thenBack(back, async () => votePost(await db(), topic, Number(form.get('post')), who, value === mine ? 0 : value, FORUM));
}

export async function acceptOn(form: FormData) {
	const topic = Number(form.get('topic')), back = `/forum/${topic}`;
	const who = await signedIn(back);
	await thenBack(back, async () => accept(await db(), topic, Number(form.get('post')), who, FORUM));
}

// ---- Spaces (/ws). Plain forms: each acts and comes back, with no script needed. ----

const slugOf = (form: FormData) => String(form.get('space') ?? '').replace(/[^a-z0-9-]/g, '');

export async function openSpace(form: FormData) {
	const who = await signedIn('/ws');
	let to: string;
	try {
		to = `/ws/${(await createSpace(await db(), who, { title: String(form.get('title') ?? ''), about: String(form.get('about') ?? '') })).id}`;
	} catch (e) {
		if (!(e instanceof QueryError)) throw e;
		to = `/ws?notice=${encodeURIComponent(e.message)}`;
	}
	redirect(to);
}

/** Invites the login in the form, or with the person's own login accepts their invitation. */
export async function addToSpace(form: FormData) {
	const space = slugOf(form), who = await signedIn('/ws');
	const own = String(form.get('login') ?? '').replace(/^@/, '').toLowerCase() === who.login.toLowerCase();
	await thenBack(own ? `/ws/${space}` : `/ws/${space}#members`, async () => addMember(await db(), space, who, String(form.get('login') ?? '').trim(), String(form.get('note') ?? '')));
}

/** Leaves, declines, or as the creator removes: takes the login in the form off the space. */
export async function removeFromSpace(form: FormData) {
	const space = slugOf(form), who = await signedIn('/ws');
	const login = String(form.get('login') ?? '');
	await thenBack(login.toLowerCase() === who.login.toLowerCase() ? '/ws' : `/ws/${space}#members`, async () => removeMember(await db(), space, who, login));
}

/** The creator deletes a space, after typing its slug. */
export async function dropSpace(form: FormData) {
	const space = slugOf(form), who = await signedIn('/ws');
	if (String(form.get('confirm') ?? '').trim() !== space) redirect(`/ws/${space}?notice=${encodeURIComponent('Type the space\'s slug exactly to delete it.')}`);
	await thenBack('/ws', async () => deleteSpace(await db(), space, who));
}

/** Choosing an option on a card: a reply to that post whose text is the option. */
export async function chooseOption(form: FormData) {
	const space = slugOf(form), topic = Number(form.get('topic')), parent = Number(form.get('post'));
	const back = `/ws/${space}/${topic}`, who = await signedIn(back);
	await thenBack(back, async () => post(await db(), { topic, space }, who, { body: String(form.get('option') ?? ''), parent }));
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

/** The plugin reviewers' demo account signs in with its password (lib/accounts/review.ts). */
export async function reviewSignIn(form: FormData) {
	const next = safeNext(form.get('next'));
	const login = reviewLogin();
	if (!login || !isReviewer(form.get('login'), form.get('password'))) {
		redirect(`/auth/review?next=${encodeURIComponent(next)}&notice=${encodeURIComponent('That login and password do not match the demo account.')}`);
	}
	const secure = (await headers()).get('x-forwarded-proto') !== 'http' && process.env.NODE_ENV === 'production';
	(await cookies()).set(COOKIE, await createSession(await db(), login, 'Plugin reviewer'), { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 7 * 86400 });
	redirect(next);
}

// The authorization request an approval form carries, checked again: the form's fields are not trusted.
async function appRequest(form: FormData) {
	const { page: back, request } = authorizeRequest((k) => form.get(k));
	if ('refuse' in request) redirect(request.refuse);
	if ('show' in request) redirect(back);
	return { request, back };
}

/** The person approves an app at /oauth/authorize: back to the app with a one-time code. */
export async function approveApp(form: FormData) {
	const { request, back } = await appRequest(form);
	const who = await signedIn(back);
	redirect(redirectBack(request.redirect_uri, { code: await issueCode(await db(), who.login, request), state: request.state }));
}

export async function denyApp(form: FormData) {
	const { request } = await appRequest(form);
	redirect(redirectBack(request.redirect_uri, { error: 'access_denied', error_description: 'the person did not approve', state: request.state }));
}

export async function dropKey(form: FormData) {
	const who = await signedIn('/keys');
	await revokeAgentKey(await db(), who.login, String(form.get('hash')));
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
