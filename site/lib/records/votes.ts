// Votes on records: up/down, an emoji, or both, with an optional note.
import { refuseKeys, type Voter } from '#lib/accounts/keys.ts';
import { screen, type Moderator } from '#lib/moderation/moderate.ts';
import { NotFoundError, QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';

export type Vote = { value?: 1 | -1; emoji?: string; note?: string; ifAbsent?: boolean };

// One emoji: a pictograph with its optional variation selector, skin tone, and ZWJ sequence.
const EMOJI = /^\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*$/u;

/** The voter's own votes on these records, by record id. */
export async function myVotes(db: Db, login: string, ids: string[]) {
	if (!ids.length) return new Map<string, { record_id: string; value: number | null; emoji: string | null; note: string | null }>();
	const rows = (await db.query<{ record_id: string; value: number | null; emoji: string | null; note: string | null }>(
		'SELECT record_id, value, emoji, note FROM open_index.votes WHERE voter = $1 AND record_id = ANY($2)', [login, ids])).rows;
	return new Map(rows.map((r) => [r.record_id, r]));
}

/** Casts or replaces a vote; with ifAbsent, keeps an existing vote and reports whether one was created. */
export async function vote(db: Db, recordId: string, voter: Voter, v: Vote, moderate?: Moderator) {
	if (v.ifAbsent !== undefined && typeof v.ifAbsent !== 'boolean') throw new QueryError('if_absent must be a boolean', 'Send if_absent: true to keep the person\'s existing vote, or leave it out to replace the vote as usual.');
	if (v.value === undefined && v.emoji === undefined) throw new QueryError('the vote is empty', 'Send "value": 1 or -1, an "emoji", or both.');
	if (v.value !== undefined && v.value !== 1 && v.value !== -1) throw new QueryError('value must be 1 or -1', 'Send "value": 1 (up) or -1 (down).');
	if (v.emoji !== undefined && !EMOJI.test(v.emoji)) throw new QueryError('emoji must be one emoji', 'Send a single emoji, e.g. "🤔".');
	const ifAbsent = v.ifAbsent === true;
	const note = (v.note ?? '').trim();
	if (note.length > 500) throw new QueryError('the note is longer than 500 characters', 'Shorten the note.');
	await refuseKeys(db, note);
	const rec = (await db.query<{ repo: string | null; record: unknown }>("SELECT record, record->>'repo' AS repo FROM open_index.records WHERE id = $1", [recordId])).rows[0];
	if (!rec) throw new NotFoundError(`no record ${JSON.stringify(recordId)}`, 'Use an id from a search result.');
	// Nobody votes on their own repository.
	const owner = rec.repo?.match(/github\.com\/([^/]+)\//i)?.[1]?.toLowerCase();
	if (owner && owner === voter.login.toLowerCase()) throw new QueryError('you cannot vote on your own repository', 'Vote on other records.');
	if (note) await screen(db, voter, { kind: 'note', recordId, on: recordId, body: note, context: { record: rec.record } }, moderate);
	const inserted = await db.query<{ record_id: string }>(
		`INSERT INTO open_index.votes (record_id, voter, agent, value, emoji, note) VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (record_id, voter) ${ifAbsent ? 'DO NOTHING' : `DO UPDATE SET agent = excluded.agent, value = excluded.value,
		   emoji = excluded.emoji, note = excluded.note, at = now()`} RETURNING record_id`,
		[recordId, voter.login, voter.agent, v.value ?? null, v.emoji ?? null, note || null],
	);
	const result = await tally(db, recordId);
	return ifAbsent ? { ...result, created: inserted.rows.length === 1 } : result;
}

export async function unvote(db: Db, recordId: string, voter: Voter) {
	await db.query('DELETE FROM open_index.votes WHERE record_id = $1 AND voter = $2', [recordId, voter.login]);
	return tally(db, recordId);
}

/** A record's votes, newest first: who voted, through which agent, how, and any note. */
export async function votes(db: Db, recordId: string) {
	return (await db.query<{ voter: string; agent: string; value: number | null; emoji: string | null; note: string | null; at: string }>(
		'SELECT voter, agent, value, emoji, note, at FROM open_index.votes WHERE record_id = $1 ORDER BY at DESC', [recordId])).rows;
}

async function tally(db: Db, recordId: string) {
	const row = (await db.query<{ score: number; reactions: Record<string, number> }>('SELECT score, reactions FROM open_index.records WHERE id = $1', [recordId])).rows[0];
	if (!row) throw new NotFoundError(`no record ${JSON.stringify(recordId)}`, 'Use an id from a search result.');
	return { id: recordId, score: row.score, reactions: row.reactions };
}
