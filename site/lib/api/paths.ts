// The paths the MCP tools take as ids. Everything on the site that a tool reads or writes has one:
//   arxiv/2610.20058        a record            arxiv/2610.20058/481   a post on it
//   forum/12                a forum topic       forum/12/502           a post in it
//   arxiv                   a source's records  forum                  the forum
//   records                 where links are submitted                  me   the signed-in account
//   me/queries              the signed-in person's saved queries (lib/accounts/queries.ts)
// A record id may itself hold slashes and end in digits, so a path is read as a record first.
import prefixes from '#lib/records/prefixes.json' with { type: 'json' };
import { NotFoundError, QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { QUERIES_PATH } from '#lib/accounts/queries.ts';

export type Target = { kind: 'all' } | { kind: 'me' } | { kind: 'queries' } | { kind: 'records' } | { kind: 'forum' } | { kind: 'source'; source: string }
	| { kind: 'record'; record: string } | { kind: 'topic'; topic: number }
	| { kind: 'post'; post: number; thread: string; record?: string; topic?: number };

export const PATH_HELP = 'A path: a record id (arxiv/2610.20058), a post on it (arxiv/2610.20058/481), forum, a forum topic (forum/12) or a post in it (forum/12/502).';
const NUMBER = /^[1-9][0-9]{0,15}$/;
const isRecord = async (db: Db, id: string) => (await db.query('SELECT 1 FROM open_index.records WHERE id = $1', [id])).rows.length > 0;

/** What a path names. Throws NotFoundError for a path that names nothing here. */
export async function resolve(db: Db, given: unknown): Promise<Target> {
	const path = typeof given === 'string' ? given.trim().replace(/^\/+|\/+$/g, '') : '';
	if (!path) return { kind: 'all' };
	if (path.length > 320) throw new QueryError('the path is too long', PATH_HELP);
	if (path === 'me' || path === 'records' || path === 'forum') return { kind: path };
	if (path === QUERIES_PATH) return { kind: 'queries' };
	const parts = path.split('/');
	if (parts[0] === 'forum') {
		if (parts.length > 3 || !parts.slice(1).every((p) => NUMBER.test(p))) throw new NotFoundError(`no ${path}`, 'A topic is forum/<number> and a post in it forum/<number>/<number>; search with in=forum to find one.');
		const topic = Number(parts[1]);
		return parts.length === 2 ? { kind: 'topic', topic } : { kind: 'post', post: Number(parts[2]), thread: `forum/${topic}`, topic };
	}
	if (parts.length === 1) {
		if (path in prefixes.prefixes) return { kind: 'source', source: path };
		throw new NotFoundError(`no ${path}`, PATH_HELP);
	}
	if (await isRecord(db, path)) return { kind: 'record', record: path };
	const last = parts.at(-1)!, record = parts.slice(0, -1).join('/');
	if (parts.length > 2 && NUMBER.test(last) && await isRecord(db, record)) return { kind: 'post', post: Number(last), thread: record, record };
	throw new NotFoundError(`no record ${JSON.stringify(path)}`, 'Use an id that search returns, e.g. arxiv/2610.20058.');
}
