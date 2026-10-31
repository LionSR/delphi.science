// Submitting a link: its metadata is read from the source and stored as an entry, as `index.py add` would,
// and the record is listed at once.
import { COLUMNS, row } from './load.ts';
import { screen, type Moderator } from './moderate.ts';
import { finishAttempt, reserveAttempt } from './moderation-audit.ts';
import type { SourceTransport } from './public-source-fetch.ts';
import { QueryError, type Db } from './query.ts';
import { blocked, detect, itemOf, looksLikeLink, NotFound, resolve } from './resolve.ts';
import { check } from './schema.ts';
import { refuseKeys, type Voter } from './votes.ts';

// Per login, agents included; shared with index.py add (MAX_ADDS_PER_DAY).
export const MAX_PER_DAY = 20;

const SEND = 'Send "url": an arXiv id or URL, a DOI, a Zenodo link, a GitHub repository, or a public HTTPS research webpage without query parameters.';

export type Submitted = { status: 'listed' | 'already_listed'; id: string; message: string; record?: Record<string, unknown> };

// An entry by id (including harmful ones, which have no record), or a record by id, URL or repository.
async function listed(db: Db, id: string, url: string) {
	return (await db.query<{ id: string }>(
		`SELECT id FROM open_index.entries WHERE id = $1
		 UNION ALL (SELECT id FROM open_index.records WHERE id = $1 OR lower(url) = lower($2) OR lower(record->>'repo') = lower($2) LIMIT 1)
		 LIMIT 1`,
		[id, url])).rows[0]?.id;
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
	if (known) return { status: 'already_listed', id: known, message: `already listed as ${known}` };
	if (!hit) throw new QueryError('the site cannot read this link', SEND);

	const day = today();
	await checkQuota(db, voter.login, day);
	const audit = await reserveAttempt(db, voter, 'submission');
	let found;
	try {
		found = await resolve(url, fetcher, webTransport);
	} catch (e) {
		await finishAttempt(db, audit, false, 'REVIEW_NEEDED: source metadata could not be read');
		if (e instanceof NotFound) throw new QueryError('the record was not found or is not public', 'Check the link, and that the record is public.');
		throw new QueryError(`${hit.source.name} could not be read just now (${e instanceof Error ? e.message : e})`, 'Try again in a few minutes.');
	}
	if (!found) throw new QueryError('the site cannot read this link', SEND);
	await refuseKeys(db, JSON.stringify(found));
	const entry = { ...found, added: day, added_by: voter.login, refreshed: day };
	check('Entry', entry, `${entry.source}/${entry.key}`);
	const item = itemOf(entry);
	const again = await listed(db, item.id, item.url); // the same record by another link
	if (again) {
		await finishAttempt(db, audit, false, 'Already listed');
		return { status: 'already_listed', id: again, message: `already listed as ${again}` };
	}
	// Moderate before writing the entry: the daily build would publish it.
	await screen(db, voter, { kind: 'submission', on: item.id, title: String(item.title), body: JSON.stringify(found), context: { record: item } }, moderate, false, undefined, audit);
	// Moderation takes time, so recheck duplicates and the quota under a per-login lock.
	const stored = await db.transaction!(async (tx) => {
		await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [voter.login]);
		const existing = await listed(tx, item.id, item.url);
		if (existing) return { inserted: false, id: existing };
		await checkQuota(tx, voter.login, day);
		const { rows } = await tx.query('INSERT INTO open_index.entries (id, entry) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id', [item.id, entry]);
		return { inserted: rows.length > 0, id: item.id };
	});
	if (!stored.inserted) return { status: 'already_listed', id: stored.id, message: `already listed as ${stored.id}` };
	// If this fails, the next build lists the record from its entry.
	await db.query(`INSERT INTO open_index.records (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
		ON CONFLICT (id) DO NOTHING`, await row(item));
	await db.query('INSERT INTO open_index.submissions (url, record_id, voter, agent) VALUES ($1, $2, $3, $4)', [url, item.id, voter.login, voter.agent]);
	return { status: 'listed', id: item.id, record: item, message: `Listed as ${item.id}, with its metadata from ${hit.source.name}.` };
}
