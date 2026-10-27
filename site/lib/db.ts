// The database: Supabase Postgres when DATABASE_URL is set (its connection pooler, transaction mode),
// otherwise Postgres in-process (PGlite) loaded with the last local build, for development.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './query.ts';

const MIGRATIONS = 'supabase/migrations';
const BUILD = '../dist/index.json';

async function open(): Promise<Db> {
	if (process.env.DATABASE_URL) {
		const { default: postgres } = await import('postgres');
		const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 5 });
		const query: Db['query'] = async (text, params = []) => ({ rows: (await sql.unsafe(text, params as never[])) as never[] });
		return { query, transaction: async (run) => {
			const result = await sql.begin(async (tx) => ({ value: await run({
				query: async (text, params = []) => ({ rows: (await tx.unsafe(text, params as never[])) as never[] }),
			}) }));
			return result.value;
		} };
	}
	const { PGlite } = await import('@electric-sql/pglite');
	const { vector } = await import('@electric-sql/pglite/vector');
	const { load } = await import('./load.ts');
	const pg = new PGlite({ extensions: { vector } });
	const dir = join(process.cwd(), MIGRATIONS);
	for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(dir, f), 'utf8'));
	await load(pg, JSON.parse(readFileSync(join(process.cwd(), BUILD), 'utf8')).items);
	return pg;
}

// One connection per server process, kept across hot reloads in development.
const cache = globalThis as { openIndexDb?: Promise<Db> };
export const db = () => (cache.openIndexDb ??= open());
