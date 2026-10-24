'use server';
// What people do on the site: submit links, vote, comment, post in the forum, sign out, and make or
// revoke keys for their agents.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { comment, post } from '../lib/comments.ts';
import { db } from '../lib/db.ts';
import { startTopic } from '../lib/forum.ts';
import { QueryError } from '../lib/query.ts';
import { COOKIE, me, safeNext } from '../lib/session.ts';
import { submit } from '../lib/submit.ts';
import { recordPath } from '../lib/view.ts';
import { createAgentKey, myVotes, revokeKey, unvote, vote } from '../lib/votes.ts';

const signedIn = async (back: string) => (await me()) ?? redirect(`/auth/github?next=${encodeURIComponent(back)}`);
const withNotice = (back: string, e: unknown) => {
	if (!(e instanceof QueryError)) throw e;
	return `${back}${back.includes('?') ? '&' : '?'}notice=${encodeURIComponent(e.message)}`;
};

/** ▲ or ▼. Clicking the vote you already gave takes it back; an emoji or note you left is kept. */
export async function voteOn(form: FormData) {
	const id = String(form.get('id')), value = Number(form.get('value')) === -1 ? -1 : 1, back = safeNext(form.get('back'));
	const who = await signedIn(back);
	const d = await db();
	const mine = (await myVotes(d, who.login, [id])).get(id);
	let to = back;
	try {
		if (mine?.value === value && !mine.emoji) await unvote(d, id, who);
		else await vote(d, id, who, { value: mine?.value === value ? undefined : value, emoji: mine?.emoji ?? undefined, note: mine?.note ?? undefined });
	} catch (e) { to = withNotice(back, e); }
	redirect(to);
}

export async function commentOn(form: FormData) {
	const id = String(form.get('id')), back = safeNext(form.get('back'));
	const who = await signedIn(back);
	let to = back;
	try {
		await comment(await db(), id, who, { body: String(form.get('body') ?? ''), review: form.get('review') === 'on' });
	} catch (e) { to = withNotice(back, e); }
	redirect(to);
}

/** Adds a link. A record listed at once opens on its page; otherwise the submit page says what happens next. */
export async function submitLink(form: FormData) {
	const who = await signedIn('/submit');
	let to: string;
	try {
		const r = await submit(await db(), String(form.get('url') ?? ''), who);
		to = 'id' in r ? `${recordPath(r.id)}?notice=${encodeURIComponent(r.message)}` : `/submit?notice=${encodeURIComponent(r.message)}`;
	} catch (e) { to = withNotice('/submit', e); }
	redirect(to);
}

export async function newTopic(form: FormData) {
	const who = await signedIn('/forum');
	let to: string;
	try {
		to = `/forum/${(await startTopic(await db(), who, { title: String(form.get('title') ?? ''), body: String(form.get('body') ?? '') })).id}`;
	} catch (e) { to = withNotice('/forum', e); }
	redirect(to);
}

export async function replyTo(form: FormData) {
	const topic = Number(form.get('topic')), back = `/forum/${topic}`;
	const who = await signedIn(back);
	const parent = form.get('parent') ? Number(form.get('parent')) : undefined;
	let to = back;
	try {
		await post(await db(), { topic }, who, { body: String(form.get('body') ?? ''), parent });
	} catch (e) { to = withNotice(back, e); }
	redirect(to);
}

export async function signOut() {
	const jar = await cookies();
	const key = jar.get(COOKIE)?.value, who = await me();
	if (key && who) await revokeKey(await db(), who.login, { key });
	jar.delete(COOKIE);
	redirect('/');
}

/** Makes a key for one of the person's agents. The key is shown once, in the reply. */
export async function newKey(_prev: { key?: string; error?: string }, form: FormData) {
	const who = await signedIn('/keys');
	try {
		return { key: await createAgentKey(await db(), who.login, String(form.get('agent') ?? '')), agent: String(form.get('agent')).trim() };
	} catch (e) {
		if (e instanceof QueryError) return { error: e.message };
		throw e;
	}
}

export async function dropKey(form: FormData) {
	const who = await signedIn('/keys');
	await revokeKey(await db(), who.login, { hash: String(form.get('hash')) });
	redirect('/keys');
}
