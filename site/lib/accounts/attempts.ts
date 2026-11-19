// Limits on the sign-in endpoints that anyone can call without an account: starting a device code and the demo
// account's password form. One row per attempt in open_index.auth_attempts, counted by caller over a window.
import { CodedError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { sha256 } from '#lib/hash.ts';

/** The caller's address as the hosting platform reports it (the first hop of X-Forwarded-For), hashed; one shared
 *  bucket when there is none, as in local development. */
export function origin(headers: { get(name: string): string | null }): string {
	const ip = (headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || headers.get('x-real-ip')?.trim() || 'unknown';
	return sha256(ip);
}

/** Counts one attempt of `kind` by `origin`, and refuses it with 429 when that makes more than `max` in `minutes`. */
export async function attempt(db: Db, kind: string, origin: string, max: number, minutes: number): Promise<void> {
	await db.query(`DELETE FROM open_index.auth_attempts WHERE at < now() - interval '1 day'`);
	await db.query('INSERT INTO open_index.auth_attempts (kind, origin) VALUES ($1, $2)', [kind, origin]);
	const { n } = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM open_index.auth_attempts
		WHERE kind = $1 AND origin = $2 AND at > now() - make_interval(mins => $3)`, [kind, origin, minutes])).rows[0];
	if (n > max) throw new CodedError(429, 'rate_limited', `too many attempts: more than ${max} in ${minutes} minutes`, `Wait ${minutes} minutes and try again.`);
}
