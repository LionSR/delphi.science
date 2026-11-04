// Loads the built records (dist/index.json items[]) into Postgres, upserting only those whose
// content_hash changed.
import type { Db } from '../db.ts';
import { sha256 } from '../hash.ts';
import { check, type Item } from '../api/schema.ts';

export type { Item };

export const COLUMNS = ['id', 'source', 'url', 'title', 'authors', 'abstract', 'tags', 'subject', 'division', 'domain', 'published',
	'category', 'origin', 'family', 'agent_ready', 'formalized', 'verified', 'withdrawn', 'gone', 'record', 'content_hash'];

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export async function row(it: Item): Promise<unknown[]> {
	const record = JSON.stringify(it);
	return [
		it.id, it.source, it.url, it.title, list(it.authors).join('; '), str(it.summary), list(it.tags).join(' '),
		str(it.subject), str(it.division), str(it.domain), /^\d{4}-\d{2}-\d{2}$/.test(str(it.published)) ? it.published : null,
		str(it.category) || 'research', str(it.origin), str(it.family), Boolean(it.agent_ready), Boolean(it.formalized),
		Boolean(it.verified), Boolean(it.withdrawn), Boolean(it.gone),
		it, // the object, not the string: postgres.js would encode a string again as a jsonb string
		sha256(record),
	];
}

/** Upserts the new and changed items in batches and returns how many were written. */
export async function load(db: Db, items: Item[], batch = 200): Promise<number> {
	for (const it of items) check('Record', it, it.id);
	const HASH = COLUMNS.indexOf('content_hash');
	const stored = new Map((await db.query<{ id: string; content_hash: string }>('SELECT id, content_hash FROM open_index.records')).rows
		.map((r) => [r.id, r.content_hash]));
	const rows = (await Promise.all(items.map(row))).filter((r) => stored.get(r[0] as string) !== r[HASH]);
	const updates = COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
	for (let i = 0; i < rows.length; i += batch) {
		const chunk = rows.slice(i, i + batch);
		const tuples = chunk.map((_, j) => `(${COLUMNS.map((_, k) => `$${j * COLUMNS.length + k + 1}`).join(', ')})`);
		await db.query(
			`INSERT INTO open_index.records (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}
			 ON CONFLICT (id) DO UPDATE SET ${updates}`,
			chunk.flat(),
		);
	}
	return rows.length;
}
