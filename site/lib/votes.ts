import type { SourceRetriever } from './public-source-checks.ts';
import { screen, type Moderator } from './moderate.ts';
// Votes on open-index records, SciRate-style: per GitHub user per record, an up or down vote, an
// emoji, or both, with an optional short note. The caller is already identified (a GitHub token from
// the registry's app, or an agent key); this module only checks the vote and writes it.
import { QueryError, type Db } from './query.ts';

export type Voter = { login: string; agent: string };
export type Vote = { value?: 1 | -1; emoji?: string; note?: string; retrieveSources?: boolean; ifAbsent?: boolean };

// One emoji: a pictograph with its optional variation selector, skin tone, and ZWJ sequence.
const EMOJI = /^\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*$/u;

export async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const MAX_AGENT_NAME = 60;

/** Agent display name shown on votes and comments ("@login via <name>"): required, trimmed, at most 60 characters. */
export function agentName(agent: unknown): string {
	const name = typeof agent === 'string' ? agent.trim() : '';
	if (!name) throw new QueryError('the agent needs a name', 'Send {"agent": "<your name>"}, e.g. "Claude Code" or "Codex": votes and comments are attributed as @<login> via that name.');
	const n = [...name].length;
	if (n > MAX_AGENT_NAME) throw new QueryError(`the agent name is ${n} characters, more than ${MAX_AGENT_NAME}`, `Send a name of at most ${MAX_AGENT_NAME} characters, e.g. "Claude Code".`);
	return name;
}

/** A new agent key for `login`'s agent. The key is returned once; only its hash is stored. */
export async function createAgentKey(db: Db, login: string, agent: string): Promise<string> {
	return newKey(db, login, agentName(agent));
}

/** Cosmetic public GitHub name, normalized and bounded by Unicode code points; never an authorization identifier. */
export function profileName(value: unknown): string {
	return typeof value === 'string' ? [...value.normalize('NFC').replace(/[\p{Cc}\s]+/gu, ' ').trim()].slice(0, 100).join('') : '';
}

/** Profile snapshots refresh on sign-in. Missing optional schema keeps the established login-only session path. */
export async function createSession(db: Db, login: string, name: unknown = '') {
	const display = profileName(name);
	const hasName = display && await db.query<{ present: boolean }>(`SELECT EXISTS (
		SELECT 1 FROM information_schema.columns WHERE table_schema='open_index' AND table_name='agent_keys' AND column_name='name'
	) AS present`).then((r) => r.rows[0]?.present === true, () => false);
	return newKey(db, login, '', hasName ? display : undefined);
}

async function newKey(db: Db, login: string, agent: string, name?: string) {
	const key = `oik_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
	if (name === undefined) await db.query('INSERT INTO open_index.agent_keys (key_hash, login, agent) VALUES ($1, $2, $3)', [await sha256(key), login, agent]);
	else await db.query('INSERT INTO open_index.agent_keys (key_hash, login, agent, name) VALUES ($1, $2, $3, $4)', [await sha256(key), login, agent, name]);
	return key;
}

/** Revokes a key: by the key itself (signing out) or, for its owner, by its hash (the /keys page). */
export async function revokeKey(db: Db, login: string, by: { key?: string; hash?: string }) {
	const hash = by.key ? await sha256(by.key) : by.hash;
	await db.query('UPDATE open_index.agent_keys SET revoked_at = now() WHERE key_hash = $1 AND login = $2 AND revoked_at IS NULL', [hash, login]);
}

/** A person's agent keys, newest first (sessions are left out). */
export async function agentKeys(db: Db, login: string) {
	return (await db.query<{ hash: string; agent: string; created_at: string; revoked_at: string | null; expires_at: string }>(
		`SELECT key_hash AS hash, agent, created_at, revoked_at, expires_at FROM open_index.agent_keys
		 WHERE login = $1 AND agent <> '' ORDER BY created_at DESC`, [login])).rows;
}

/** The voter's own votes on these records, by record id. */
export async function myVotes(db: Db, login: string, ids: string[]) {
	const rows = (await db.query<{ record_id: string; value: number | null; emoji: string | null; note: string | null }>(
		'SELECT record_id, value, emoji, note FROM open_index.votes WHERE voter = $1 AND record_id = ANY($2)', [login, ids])).rows;
	return new Map(rows.map((r) => [r.record_id, r]));
}

/** Who an agent key belongs to, or null if it is unknown or revoked. */
export async function voterFromKey(db: Db, key: string): Promise<Voter | null> {
	const rows = (await db.query<Voter>('SELECT login, agent FROM open_index.agent_keys WHERE key_hash = $1 AND revoked_at IS NULL AND expires_at > now()', [await sha256(key)])).rows;
	return rows[0] ?? null;
}

export type Person = Voter & { name: string };

/** Only active human session keys may identify a browser user or approve a device request. */
export async function personFromSession(db: Db, key: string): Promise<Person | null> {
	const person = (await db.query<Person>(`SELECT k.login, k.agent, coalesce(nullif(trim(to_jsonb(k)->>'name'), ''), k.login) AS name
		FROM open_index.agent_keys k WHERE k.key_hash=$1 AND k.agent='' AND k.revoked_at IS NULL AND k.expires_at > now()`, [await sha256(key)])).rows[0];
	return person ? { ...person, name: profileName(person.name) || person.login } : null;
}

/** Text that is about to be published must not carry a key. Any key in it is revoked, and the text refused. */
export async function refuseKeys(db: Db, text: string) {
	const keys = text.match(/oik_[0-9a-f]{48}/g);
	if (!keys) return;
	const hashes = await Promise.all(keys.map(sha256));
	await db.query('UPDATE open_index.agent_keys SET revoked_at = now() WHERE key_hash = ANY($1) AND revoked_at IS NULL', [hashes]);
	throw new QueryError('the text contains an agent key, so it was not posted and the key is now revoked', 'Never post a key. Get a new one: see /llms.txt.');
}

/** Normal votes update an owner's choice; opt-in ifAbsent atomically inserts without replacing it. */
export async function vote(db: Db, recordId: string, voter: Voter, v: Vote, moderate?: Moderator, fetchSource?: SourceRetriever) {
	if (v.ifAbsent !== undefined && typeof v.ifAbsent !== 'boolean') throw new QueryError('if_absent must be a boolean', 'Send if_absent: true to preserve an existing owner vote, or omit it for normal updates.');
	if (v.value === undefined && v.emoji === undefined) throw new QueryError('the vote is empty', 'Send "value": 1 or -1, an "emoji", or both.');
	if (v.value !== undefined && v.value !== 1 && v.value !== -1) throw new QueryError('value must be 1 or -1', 'Send "value": 1 (up) or -1 (down).');
	if (v.emoji !== undefined && !EMOJI.test(v.emoji)) throw new QueryError('emoji must be one emoji', 'Send a single emoji, e.g. "🤔".');
	const note = (v.note ?? '').trim();
	if (note.length > 500) throw new QueryError('the note is longer than 500 characters', 'Shorten the note.');
	await refuseKeys(db, note);
	const rec = (await db.query<{ repo: string | null; record: unknown }>("SELECT record, record->>'repo' AS repo FROM open_index.records WHERE id = $1", [recordId])).rows[0];
	if (!rec) throw new QueryError(`no record ${JSON.stringify(recordId)}`, 'Use an id from a search result.');
	// As on SciRate's open issue #541: nobody scores their own repository.
	const owner = rec.repo?.match(/github\.com\/([^/]+)\//i)?.[1]?.toLowerCase();
	if (owner && owner === voter.login.toLowerCase()) throw new QueryError('you cannot vote on your own repository', 'Vote on other records.');
	if (note) await screen(db, voter, { kind: 'note', recordId, on: recordId, body: note, context: { record: rec.record } }, moderate, Boolean(v.retrieveSources), fetchSource);
	const inserted = await db.query<{ record_id: string }>(
		`INSERT INTO open_index.votes (record_id, voter, agent, value, emoji, note) VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (record_id, voter) ${v.ifAbsent === true ? 'DO NOTHING' : `DO UPDATE SET agent = excluded.agent, value = excluded.value,
		   emoji = excluded.emoji, note = excluded.note, at = now()`} RETURNING record_id`,
		[recordId, voter.login, voter.agent, v.value ?? null, v.emoji ?? null, note || null],
	);
	const result = await tally(db, recordId);
	return v.ifAbsent === true ? { ...result, created: inserted.rows.length === 1 } : result;
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
	if (!row) throw new QueryError(`no record ${JSON.stringify(recordId)}`, 'Use an id from a search result.'); // unvote on an unknown id
	return { id: recordId, score: row.score, reactions: row.reactions };
}
