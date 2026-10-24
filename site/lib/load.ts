// Load the open index's records (dist/index.json, items[]) into Postgres. Upserts by id, so a
// rebuild only rewrites what changed; the trigger in the migration records each add and update in
// open_index.changes. content_hash covers the served record, so labels and embeddings are redone only
// when it changes.
import type { Db } from './query.ts';

export type Item = Record<string, unknown> & { id: string; source: string; url: string; title: string };

const COLUMNS = ['id', 'source', 'url', 'title', 'authors', 'abstract', 'tags', 'subject', 'division', 'domain', 'published',
	'category', 'origin', 'family', 'agent_ready', 'formalized', 'verified', 'withdrawn', 'gone', 'record', 'content_hash'];

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

export async function row(it: Item): Promise<unknown[]> {
	const record = JSON.stringify(it);
	return [
		it.id, it.source, it.url, it.title, list(it.authors).join('; '), str(it.summary), list(it.tags).join(' '),
		str(it.subject), str(it.division), str(it.domain), /^\d{4}-\d{2}-\d{2}$/.test(str(it.published)) ? it.published : null,
		str(it.category) || 'research', str(it.origin), str(it.family), Boolean(it.agent_ready), Boolean(it.formalized),
		// The object, not the string: postgres.js would encode a string a second time into a jsonb string.
		Boolean(it.verified), Boolean(it.withdrawn), Boolean(it.gone), it, await sha256(record),
	];
}

/** Upserts the new and changed items in batches; unchanged ones are never sent. Returns how many were written. */
export async function load(db: Db, items: Item[], batch = 200): Promise<number> {
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
