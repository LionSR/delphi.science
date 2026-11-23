// Submitting a link: its metadata is read from the source and stored as an entry, as `index.py add` would,
// and the record is listed at once.
import { COLUMNS, row } from './load.ts';
import { screen, type Moderator } from '#lib/moderation/moderate.ts';
import { publicWebTarget, webKey, type SourceTransport } from '#lib/moderation/source-fetch.ts';
import { QueryError } from '#lib/errors.ts';
import type { Db } from '#lib/db.ts';
import { blocked, detect, itemOf, looksLikeLink, NotFound, resolve } from './resolve.ts';
import { check } from '#lib/api/schema.ts';
import { refuseKeys, type Voter } from '#lib/accounts/keys.ts';

// Per login, agents included; shared with index.py add (MAX_ADDS_PER_DAY).
export const MAX_PER_DAY = 20;

const SEND = 'Send "url": an arXiv id or URL, a DOI, a Zenodo link, a GitHub repository, or a public HTTPS research webpage without query parameters.';

type Submitted = { status: 'listed' | 'already_listed'; id: string; message: string; record?: Record<string, unknown> };
const alreadyListed = (id: string): Submitted => ({ status: 'already_listed', id, message: `already listed as ${id}` });

// An entry by id (including harmful ones, which have no record), or a record by id, URL or repository.
// Web records are matched by canonical URL rather than slug ID so distinct URLs that share a readable slug do not collide.
async function listed(db: Db, id: string, url: string) {
	if (id.startsWith('web/')) {
		let canonical = url;
		try { canonical = publicWebTarget(url).canonical; } catch { /* keep raw url for lookup */ }
		return (await db.query<{ id: string }>(
			`SELECT id FROM open_index.entries WHERE entry->>'url' = $1 AND entry->>'merged_into' IS NULL
			 UNION ALL (SELECT id FROM open_index.records WHERE url = $1 LIMIT 1)
			 LIMIT 1`,
			[canonical])).rows[0]?.id;
	}
	return (await db.query<{ id: string }>(
		`SELECT id FROM open_index.entries WHERE id = $1
		 UNION ALL (SELECT id FROM open_index.records WHERE id = $1 OR lower(url) = lower($2) OR lower(record->>'repo') = lower($2) LIMIT 1)
		 LIMIT 1`,
		[id, url])).rows[0]?.id;
}

async function idTaken(db: Db, id: string) {
	return Boolean((await db.query<{ id: string }>(
		'SELECT id FROM open_index.entries WHERE id = $1 UNION ALL (SELECT id FROM open_index.records WHERE id = $1 LIMIT 1) LIMIT 1',
		[id])).rows.length);
}

// UTC, as index.py writes it.
const today = () => new Date().toISOString().slice(0, 10);

async function checkQuota(db: Db, login: string, day: string) {
	const n = (await db.query<{ n: number }>(
		"SELECT count(*)::int AS n FROM open_index.entries WHERE entry->>'added_by' = $1 AND entry->>'added' = $2", [login, day])).rows[0].n;
	if (n >= MAX_PER_DAY) throw new QueryError(`@${login} has added ${MAX_PER_DAY} links today`, 'Try again tomorrow.');
}

export async function submit(db: Db, link: string, voter: Voter, fetcher: typeof fetch = fetch, moderate?: Moderator, webTransport?: SourceTransport): Promise<Submitted> {
	const url = (link ?? '').trim();
	if (!looksLikeLink(url)) throw new QueryError('send one link', SEND);
	if (blocked(url)) throw new QueryError('this venue is not listed', 'Most of what it holds is not research. Submit the work from arXiv, a journal (DOI) or Zenodo instead.');
	await refuseKeys(db, url);
	const hit = detect(url);
	const known = await listed(db, hit ? `${hit.source.name}/${hit.key}` : '', url);
	if (known) return alreadyListed(known);
	if (!hit) throw new QueryError('the site cannot read this link', SEND);

	const day = today();
	await checkQuota(db, voter.login, day);
	let found;
	try {
		found = await resolve(url, fetcher, webTransport);
	} catch (e) {
		if (e instanceof NotFound) throw new QueryError('the record was not found or is not public', 'Check the link, and that the record is public.');
		throw new QueryError(`${hit.source.name} could not be read just now (${e instanceof Error ? e.message : e})`, 'Try again in a few minutes.');
	}
	if (!found) throw new QueryError('the site cannot read this link', SEND);
	await refuseKeys(db, JSON.stringify(found));
	const again = await listed(db, `${found.source}/${found.key}`, found.url); // the same record by another link
	if (again) return alreadyListed(again);
	const key = found.source === 'web' && await idTaken(db, `web/${found.key}`) ? webKey(found.url, true) : found.key;
	const entry = { ...found, key, added: day, added_by: voter.login, refreshed: day };
	check('Entry', entry, `${entry.source}/${entry.key}`);
	const item = itemOf(entry);
	// Moderate before writing the entry: the daily build would publish it.
	await screen(db, voter, { kind: 'submission', on: item.id, title: String(item.title), body: JSON.stringify(found), context: { record: item } }, moderate);
	const { rows } = await db.query('INSERT INTO open_index.entries (id, entry) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id', [item.id, entry]);
	if (!rows.length) return alreadyListed((await listed(db, item.id, item.url)) ?? item.id);
	// If this fails, the next build lists the record from its entry.
	await db.query(`INSERT INTO open_index.records (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
		ON CONFLICT (id) DO NOTHING`, row(item));
	await db.query('INSERT INTO open_index.submissions (url, record_id, voter, agent) VALUES ($1, $2, $3, $4)', [url, item.id, voter.login, voter.agent]);
	return { status: 'listed', id: item.id, record: item, message: `Listed as ${item.id}, with its metadata from ${hit.source.name}.` };
}
