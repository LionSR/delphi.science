// The agent and session keys that identify voters. A key is shown once; only its SHA-256 hash is stored.
import { randomBytes } from 'node:crypto';
import type { Db } from '#lib/db.ts';
import { QueryError } from '#lib/errors.ts';
import { sha256 } from '#lib/hash.ts';

export type Voter = { login: string; agent: string };
/** A signed-in person: a voter with agent '', and their GitHub display name. */
export type Person = Voter & { name: string };

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

/** A GitHub display name for show only: NFC, whitespace and control characters collapsed, at most 100 code points. */
export function profileName(value: unknown): string {
	if (typeof value !== 'string') return '';
	return [...value.normalize('NFC').replace(/[\p{Cc}\s]+/gu, ' ').trim()].slice(0, 100).join('');
}

/** A new session key, with the person's GitHub display name. */
export async function createSession(db: Db, login: string, name: unknown = ''): Promise<string> {
	return newKey(db, login, '', profileName(name));
}

async function newKey(db: Db, login: string, agent: string, name = '') {
	const key = `oik_${randomBytes(24).toString('hex')}`;
	await db.query('INSERT INTO open_index.agent_keys (key_hash, login, agent, name) VALUES ($1, $2, $3, $4)', [sha256(key), login, agent, name]);
	return key;
}

/** Revokes one of `login`'s keys, sessions included: by the key itself (signing out) or by its hash. */
export async function revokeKey(db: Db, login: string, by: { key?: string; hash?: string }) {
	const hash = by.key ? sha256(by.key) : by.hash;
	await db.query('UPDATE open_index.agent_keys SET revoked_at = now() WHERE key_hash = $1 AND login = $2 AND revoked_at IS NULL', [hash, login]);
}

/** A person's agent keys, newest first (sessions are left out). */
export async function agentKeys(db: Db, login: string) {
	return (await db.query<{ hash: string; agent: string; created_at: string; revoked_at: string | null; expires_at: string }>(
		`SELECT key_hash AS hash, agent, created_at, revoked_at, expires_at FROM open_index.agent_keys
		 WHERE login = $1 AND agent <> '' ORDER BY created_at DESC`, [login])).rows;
}

/** Revokes one of `login`'s agent keys (not a browser session) by hash; false if it is not theirs or already revoked. */
export async function revokeAgentKey(db: Db, login: string, hash: string): Promise<boolean> {
	return (await db.query<{ key_hash: string }>(`UPDATE open_index.agent_keys SET revoked_at = now()
		WHERE key_hash = $1 AND login = $2 AND agent <> '' AND revoked_at IS NULL RETURNING key_hash`, [hash, login])).rows.length === 1;
}

/** Who a key belongs to (agent '' for a session), or null if it is unknown, revoked or expired. */
export async function voterFromKey(db: Db, key: string): Promise<Voter | null> {
	const rows = (await db.query<Voter>('SELECT login, agent FROM open_index.agent_keys WHERE key_hash = $1 AND revoked_at IS NULL AND expires_at > now()', [sha256(key)])).rows;
	return rows[0] ?? null;
}

/** The person behind an active session key (agent keys do not count), or null. A blank name falls back to the login. */
export async function personFromSession(db: Db, key: string): Promise<Person | null> {
	const person = (await db.query<Person>(`SELECT login, agent, name FROM open_index.agent_keys
		WHERE key_hash = $1 AND agent = '' AND revoked_at IS NULL AND expires_at > now()`, [sha256(key)])).rows[0];
	return person ? { ...person, name: profileName(person.name) || person.login } : null;
}

/** Refuses text that contains an agent key, and revokes the key. */
export async function refuseKeys(db: Db, text: string) {
	const keys = text.match(/oik_[0-9a-f]{48}/g);
	if (!keys) return;
	const hashes = keys.map((k) => sha256(k));
	await db.query('UPDATE open_index.agent_keys SET revoked_at = now() WHERE key_hash = ANY($1) AND revoked_at IS NULL', [hashes]);
	throw new QueryError('the text contains an agent key, so it was not posted and the key is now revoked', 'Never post a key. Get a new one: see /llms.txt.');
}
