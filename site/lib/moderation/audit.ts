// The daily log of attempts (open_index.moderations), shared by posting and explicit source checks.
import { QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { ModerationError } from '#lib/errors.ts';
import type { Voter } from '#lib/accounts/keys.ts';

const MAX_ATTEMPTS_PER_DAY = 30;
const unavailable = () => new ModerationError('moderation_unavailable',
	'REVIEW_NEEDED: The server cannot safely reserve a check/submission attempt. Try again later.',
	'Keep your draft; the private attempt ledger must be available before retrieval or moderation.');

/** Reserve one of the voter's daily attempts, serialized per login, and return its audit row id. */
export async function reserveAttempt(db: Db, who: Voter, kind: string): Promise<number> {
	if (!db.transaction) throw unavailable();
	try {
		return await db.transaction(async (tx) => {
			await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [who.login]);
			const used = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM open_index.moderations WHERE voter=$1 AND at>now()-interval '1 day'", [who.login])).rows[0].n;
			if (used >= MAX_ATTEMPTS_PER_DAY) {
				throw new QueryError(`@${who.login} has used ${MAX_ATTEMPTS_PER_DAY} check/submission attempts today, agents included`,
					'Posting and explicit source-check batches share this 30-attempt daily limit. Try again tomorrow.');
			}
			return (await tx.query<{ id: number }>("INSERT INTO open_index.moderations (voter,agent,kind,publish,reason) VALUES ($1,$2,$3,false,'REVIEW_NEEDED: check pending') RETURNING id", [who.login, who.agent, kind])).rows[0].id;
		});
	} catch (e) {
		if (e instanceof QueryError) throw e;
		throw unavailable();
	}
}

/** Record the attempt's outcome; a failed or missing update is a ledger failure. */
export async function finishAttempt(db: Db, id: number, publish: boolean, reason: string): Promise<void> {
	const updated = await db.query('UPDATE open_index.moderations SET publish=$2,reason=$3 WHERE id=$1 RETURNING id', [id, publish, reason])
		.then((r) => r.rows.length, () => 0);
	if (updated !== 1) throw unavailable();
}
