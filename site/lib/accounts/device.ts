// The device flow for agent keys (RFC 8628): the agent shows its person a user code to approve, then
// redeems its private device code for a key, once.
import { QueryError } from '../errors.ts';
import type { Db } from '../db.ts';
import { agentName, createAgentKey, sha256 } from './keys.ts';

const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, so codes spell no words
const random = (n: number, alphabet: string) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => alphabet[b % alphabet.length]).join('');

export async function startDevice(db: Db, agent: unknown) {
	const name = agentName(agent); // validated before anyone is asked to approve it
	const deviceCode = random(40, '0123456789abcdefghijklmnopqrstuvwxyz');
	const userCode = `${random(4, LETTERS)}-${random(4, LETTERS)}`;
	await db.query('INSERT INTO open_index.device_codes (device_hash, user_code, agent) VALUES ($1, $2, $3)', [await sha256(deviceCode), userCode, name]);
	return { device_code: deviceCode, user_code: userCode, expires_in: 600, interval: 5 };
}

/** The pending request a person is looking at, or null if the code is unknown, used or expired. */
export async function pendingDevice(db: Db, userCode: string) {
	const rows = (await db.query<{ agent: string; login: string | null }>(
		'SELECT agent, login FROM open_index.device_codes WHERE user_code = $1 AND used_at IS NULL AND expires_at > now()',
		[userCode.trim().toUpperCase()])).rows;
	return rows[0] ?? null;
}

export async function approveDevice(db: Db, userCode: string, login: string) {
	const { rows } = await db.query('UPDATE open_index.device_codes SET login = $2 WHERE user_code = $1 AND login IS NULL AND used_at IS NULL AND expires_at > now() RETURNING 1',
		[userCode.trim().toUpperCase(), login]);
	if (!rows.length) throw new QueryError('this code is unknown, already used, or expired', 'Ask your agent to start again.');
}

export async function denyDevice(db: Db, userCode: string) {
	await db.query('UPDATE open_index.device_codes SET used_at = now() WHERE user_code = $1 AND used_at IS NULL', [userCode.trim().toUpperCase()]);
}

/** The agent's key once its person has approved; 'pending' before that. Each device code gives one key. */
export async function redeemDevice(db: Db, deviceCode: string): Promise<{ key: string; login: string; agent: string } | 'pending'> {
	const hash = await sha256(String(deviceCode ?? ''));
	const row = (await db.query<{ agent: string; login: string | null; live: boolean }>(
		'SELECT agent, login, (used_at IS NULL AND expires_at > now()) AS live FROM open_index.device_codes WHERE device_hash = $1', [hash])).rows[0];
	if (!row || !row.live) throw new QueryError('this device code is unknown, used, denied, or expired', 'Start again: POST /api/v1/keys/device.');
	if (!row.login) return 'pending';
	const claimed = (await db.query('UPDATE open_index.device_codes SET used_at = now() WHERE device_hash = $1 AND used_at IS NULL RETURNING 1', [hash])).rows.length;
	if (!claimed) throw new QueryError('this device code was already used', 'Start again: POST /api/v1/keys/device.');
	return { key: await createAgentKey(db, row.login, row.agent), login: row.login, agent: row.agent };
}
