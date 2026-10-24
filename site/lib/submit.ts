// Submitting a link: a paper, a repository, a dataset, anything with a URL or an id. The record's
// metadata is read from its source (resolve.ts) and the record is listed at once; links the site does
// not read itself wait for the daily pull. Nothing is typed in by hand, as in `index.py add`.
import { COLUMNS, row } from './load.ts';
import { QueryError, type Db } from './query.ts';
import { detect, looksLikeLink, NotFound, resolve } from './resolve.ts';
import { refuseKeys, type Voter } from './votes.ts';

export const MAX_PER_DAY = 20; // per GitHub login, as index.py's MAX_ADDS_PER_DAY

export type Submitted =
	| { status: 'listed' | 'already_listed'; id: string; message: string; record?: Record<string, unknown> }
	| { status: 'queued'; message: string };

async function listed(db: Db, id: string, url: string) {
	return (await db.query<{ id: string }>(
		`SELECT id FROM open_index.records WHERE id = $1 OR lower(url) = lower($2) OR lower(record->>'repo') = lower($2) LIMIT 1`,
		[id, url])).rows[0]?.id;
}

export async function submit(db: Db, link: string, voter: Voter, fetcher: typeof fetch = fetch): Promise<Submitted> {
	const url = (link ?? '').trim();
	if (!looksLikeLink(url)) throw new QueryError('send one link', 'Send "url": an arXiv id or URL, a GitHub repository, a DOI, or any page with citation metadata.');
	await refuseKeys(db, url);
	const hit = detect(url);
	const known = await listed(db, hit ? `${hit.source.name}/${hit.key}` : '', url);
	if (known) return { status: 'already_listed', id: known, message: `already listed as ${known}` };

	const today = (await db.query<{ n: number }>(
		`SELECT count(*)::int AS n FROM open_index.submissions WHERE voter = $1 AND at > now() - interval '1 day'`, [voter.login])).rows[0].n;
	if (today >= MAX_PER_DAY) throw new QueryError(`@${voter.login} has added ${MAX_PER_DAY} links today`, 'Try again tomorrow.');
	const queue = async (message: string): Promise<Submitted> => {
		const waiting = (await db.query('SELECT 1 FROM open_index.submissions WHERE lower(url) = lower($1) AND filed_at IS NULL', [url])).rows.length;
		if (!waiting) await db.query('INSERT INTO open_index.submissions (url, voter, agent) VALUES ($1, $2, $3)', [url, voter.login, voter.agent]);
		return { status: 'queued', message };
	};
	if (!hit) return queue('Submitted. The daily pull reads this source and lists the record within a day.');

	let item;
	try {
		item = await resolve(url, fetcher);
	} catch (e) {
		if (e instanceof NotFound) throw new QueryError('the record was not found or is not public', 'Check the link, and that the record is public.');
		return queue(`Submitted. ${hit.source.name} could not be read just now (${e instanceof Error ? e.message : e}); the daily pull will try again.`);
	}
	if (!item) return queue('Submitted. The daily pull will list it.');
	const again = await listed(db, item.id, item.url); // e.g. an APP paper's repository, or the same record by another link
	if (again) return { status: 'already_listed', id: again, message: `already listed as ${again}` };
	await db.query(`INSERT INTO open_index.records (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
		ON CONFLICT (id) DO NOTHING`, await row(item));
	await db.query('INSERT INTO open_index.submissions (url, record_id, voter, agent) VALUES ($1, $2, $3, $4)', [url, item.id, voter.login, voter.agent]);
	return { status: 'listed', id: item.id, record: item,
		message: `Listed as ${item.id}, with its metadata from ${hit.source.name}. An agent labels it in the next daily pull.` };
}

export type Submission = { url: string; record_id: string | null; title: string | null; voter: string; agent: string; at: string; filed_at: string | null };

/** The newest submissions, with the record each one became, if it is listed yet. */
export async function submissions(db: Db, limit = 20): Promise<Submission[]> {
	return (await db.query<Submission>(
		`SELECT s.url, s.record_id, r.title, s.voter, s.agent, s.at, s.filed_at FROM open_index.submissions s
		 LEFT JOIN open_index.records r ON r.id = s.record_id ORDER BY s.at DESC, s.id DESC LIMIT $1`, [limit])).rows;
}
