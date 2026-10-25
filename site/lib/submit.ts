// Submitting a link: a paper, a dataset or a repository, by its URL or id. The record's metadata is read
// from its source (resolve.ts) and the record is listed at once, in the database only. Nothing is typed in
// by hand, as in `index.py add`.
import { COLUMNS, row } from './load.ts';
import { QueryError, type Db } from './query.ts';
import { blocked, detect, looksLikeLink, NotFound, NotTaken, resolve } from './resolve.ts';
import { refuseKeys, type Voter } from './votes.ts';

export const MAX_PER_DAY = 20; // per GitHub login, as index.py's MAX_ADDS_PER_DAY

const SEND = 'Send "url": an arXiv id or URL, a DOI, a Zenodo link, or a GitHub repository.';

export type Submitted = { status: 'listed' | 'already_listed'; id: string; message: string; record?: Record<string, unknown> };

async function listed(db: Db, id: string, url: string) {
	return (await db.query<{ id: string }>(
		`SELECT id FROM open_index.records WHERE id = $1 OR lower(url) = lower($2) OR lower(record->>'repo') = lower($2) LIMIT 1`,
		[id, url])).rows[0]?.id;
}

export async function submit(db: Db, link: string, voter: Voter, fetcher: typeof fetch = fetch): Promise<Submitted> {
	const url = (link ?? '').trim();
	if (!looksLikeLink(url)) throw new QueryError('send one link', SEND);
	if (blocked(url)) throw new QueryError('this venue is not listed', 'Most of what it holds is not research. Submit the work from arXiv, a journal (DOI) or Zenodo instead.');
	await refuseKeys(db, url);
	const hit = detect(url);
	const known = await listed(db, hit ? `${hit.source.name}/${hit.key}` : '', url);
	if (known) return { status: 'already_listed', id: known, message: `already listed as ${known}` };
	if (!hit) throw new QueryError('the site cannot read this link', SEND);

	const today = (await db.query<{ n: number }>(
		`SELECT count(*)::int AS n FROM open_index.submissions WHERE voter = $1 AND at > now() - interval '1 day'`, [voter.login])).rows[0].n;
	if (today >= MAX_PER_DAY) throw new QueryError(`@${voter.login} has added ${MAX_PER_DAY} links today`, 'Try again tomorrow.');
	let item;
	try {
		item = await resolve(url, fetcher);
	} catch (e) {
		if (e instanceof NotTaken) throw new QueryError(`not listed: ${e.message}`, 'Repositories are listed on their own only when well used or citable. Submit the paper it belongs to instead.');
		if (e instanceof NotFound) throw new QueryError('the record was not found or is not public', 'Check the link, and that the record is public.');
		throw new QueryError(`${hit.source.name} could not be read just now (${e instanceof Error ? e.message : e})`, 'Try again in a few minutes.');
	}
	if (!item) throw new QueryError('the site cannot read this link', SEND);
	const again = await listed(db, item.id, item.url); // e.g. an APP paper's repository, or the same record by another link
	if (again) return { status: 'already_listed', id: again, message: `already listed as ${again}` };
	await db.query(`INSERT INTO open_index.records (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
		ON CONFLICT (id) DO NOTHING`, await row(item));
	await db.query('INSERT INTO open_index.submissions (url, record_id, voter, agent) VALUES ($1, $2, $3, $4)', [url, item.id, voter.login, voter.agent]);
	return { status: 'listed', id: item.id, record: item, message: `Listed as ${item.id}, with its metadata from ${hit.source.name}.` };
}
