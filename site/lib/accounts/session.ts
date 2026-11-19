// Site sessions: an agent key with an empty agent name, kept in an httpOnly cookie.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { db } from '#lib/db.ts';
import { personFromSession, type Person } from './keys.ts';

export const COOKIE = 'oi_session';
export const STATE = 'oi_state';

/** The signed-in person, or null. Read once per render, since the layout and the page both ask; outside a render
 *  (form actions, route handlers) each call reads the cookie again. */
export const me = cache(async (): Promise<Person | null> => {
	const key = (await cookies()).get(COOKIE)?.value;
	return key ? personFromSession(await db(), key) : null;
});

/** The signed-in person; anyone else goes to GitHub sign-in and comes back to `back`. */
export const signedIn = async (back: string) => (await me()) ?? redirect(`/auth/github?next=${encodeURIComponent(back)}`);

/** A local path to return to after signing in; anything else goes home. */
export const safeNext = (next: unknown) => (typeof next === 'string' && /^\/(?![\/\\])[^\\\u0000-\u001f]*$/.test(next) ? next : '/');
