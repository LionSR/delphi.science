// The paths the MCP tools take as ids. Everything on the site that a tool reads or writes has one:
//   arxiv/2610.20058        a record            arxiv/2610.20058/481   a post on it
//   forum/12                a forum topic       forum/12/502           a post in it
//   arxiv                   a source's records  forum                  the forum
//   records                 where links are submitted                  me   the signed-in account
//   ws                      the caller's spaces     ws/<slug>              a space (private: its members only)
//   ws/<slug>/12            a topic in it           ws/<slug>/12/502       a post in that topic
//   ws/<slug>/members       who is in it            ws/<slug>/members/<login>   one member or invitation
// A record id may itself hold slashes and end in digits, so a path is read as a record first.
import prefixes from '#lib/records/prefixes.json' with { type: 'json' };
import { NotFoundError, QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { canRead, FORUM, type Reader } from '#lib/posts/visibility.ts';

export type Target = { kind: 'all' } | { kind: 'me' } | { kind: 'records' } | { kind: 'forum' } | { kind: 'source'; source: string }
	| { kind: 'record'; record: string } | { kind: 'topic'; topic: number; space: string }
	| { kind: 'post'; post: number; thread: string; record?: string; topic?: number; space?: string }
	| { kind: 'spaces' } | { kind: 'space'; space: string } | { kind: 'members'; space: string } | { kind: 'member'; space: string; login: string };

export const PATH_HELP = 'A path: a record id (arxiv/2610.20058), a post on it (arxiv/2610.20058/481), forum, a forum topic (forum/12) or a post in it (forum/12/502).';
/** The paths of spaces, for messages (PATH_HELP is part of the published tool descriptions and stays as it is). */
export const SPACE_HELP = 'Spaces: ws lists yours and your invitations; ws/<slug> is one, ws/<slug>/<number> a topic in it, ws/<slug>/<number>/<number> a post, ws/<slug>/members who is in it.';
const NUMBER = /^[1-9][0-9]{0,15}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const isRecord = async (db: Db, id: string) => (await db.query('SELECT 1 FROM open_index.records WHERE id = $1', [id])).rows.length > 0;

/** What a path names, for `who`. Throws NotFoundError for a path that names nothing here, and the same for a space
 * `who` cannot read, or anything in it. */
export async function resolve(db: Db, given: unknown, who: Reader): Promise<Target> {
	const path = typeof given === 'string' ? given.trim().replace(/^\/+|\/+$/g, '') : '';
	if (!path) return { kind: 'all' };
	if (path.length > 320) throw new QueryError('the path is too long', PATH_HELP);
	if (path === 'me' || path === 'records' || path === 'forum') return { kind: path };
	if (path === 'ws') return { kind: 'spaces' };
	const parts = path.split('/');
	if (parts[0] === 'ws') {
		const none = () => new NotFoundError(`no ${path}`, SPACE_HELP);
		const space = parts[1];
		if (!SLUG.test(space) || space === FORUM) throw none();
		// The member list answers for itself (lib/posts/spaces.ts): a person invited may act on their own entry before they can read the space.
		if (parts[2] === 'members' && parts.length <= 4) return parts.length === 3 ? { kind: 'members', space } : { kind: 'member', space, login: parts[3] };
		if (parts.length > 4 || !parts.slice(2).every((p) => NUMBER.test(p)) || !await canRead(db, space, who)) throw none();
		if (parts.length === 2) return { kind: 'space', space };
		const topic = Number(parts[2]);
		return parts.length === 3 ? { kind: 'topic', topic, space } : { kind: 'post', post: Number(parts[3]), thread: `ws/${space}/${topic}`, topic, space };
	}
	if (parts[0] === 'forum') {
		if (parts.length > 3 || !parts.slice(1).every((p) => NUMBER.test(p))) throw new NotFoundError(`no ${path}`, 'A topic is forum/<number> and a post in it forum/<number>/<number>; search with in=forum to find one.');
		const topic = Number(parts[1]);
		return parts.length === 2 ? { kind: 'topic', topic, space: FORUM } : { kind: 'post', post: Number(parts[2]), thread: `forum/${topic}`, topic, space: FORUM };
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
