// For tests: an in-process Postgres (PGlite with pgvector) carrying the same migrations as production.
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);

/** dist/index.json, the last local build of the records; tests that need it skip when it is absent. */
export const BUILD = new URL('../../dist/index.json', import.meta.url);

/** Every migration, in the order they apply. */
export const migrations = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
	.map((name) => ({ name, sql: readFileSync(new URL(name, MIGRATIONS), 'utf8') }));

/** Applies every migration to `db` and returns it. */
export async function migrate<T extends PGlite>(db: T): Promise<T> {
	for (const m of migrations()) await db.exec(m.sql);
	return db;
}

/** A new database with every migration applied. */
export const migratedDb = () => migrate(new PGlite({ extensions: { vector } }));
