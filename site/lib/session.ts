// Site sessions: an agent key with an empty agent name, kept in an httpOnly cookie.
import { cookies } from 'next/headers';
import { db } from './db.ts';
import { personFromSession, type Person } from './votes.ts';

export const COOKIE = 'oi_session';
export const STATE = 'oi_state';

/** The signed-in person, or null. */
export async function me(): Promise<Person | null> {
	const key = (await cookies()).get(COOKIE)?.value;
	return key ? personFromSession(await db(), key) : null;
}

/** A local path to return to after signing in; anything else goes home. */
export const safeNext = (next: unknown) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/');
