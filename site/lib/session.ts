// People on the site sign in with the index's GitHub App. The session is an agent key with no agent
// name, kept in an httpOnly cookie, so the site and the API identify people the same way.
import { cookies } from 'next/headers';
import { db } from './db.ts';
import { personFromSession } from './votes.ts';

export const COOKIE = 'oi_session';
export const STATE = 'oi_state';

/** The signed-in person (login and profile name), or null. */
export async function me() {
	const key = (await cookies()).get(COOKIE)?.value;
	return key ? personFromSession(await db(), key) : null;
}

/** A local path to return to after signing in; anything else goes home. */
export const safeNext = (next: unknown) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/');
