// For tests: an in-process Postgres (PGlite with pgvector) carrying the same migrations as production, the last local
// build of the records, and the hooks that let tests call route handlers.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import type { Item } from './api/schema.ts';
import { migrations as migrationsIn } from './db.ts';

const MIGRATIONS = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

/** dist/index.json, the last local build of the records; tests that need it skip when it is absent. */
export const BUILD = new URL('../../dist/index.json', import.meta.url);

/** The records of the last local build. */
export const buildItems = (): Item[] => JSON.parse(readFileSync(BUILD, 'utf8')).items;

/** Every discussed record of the build and 300 others: enough for each field to appear, quick to load. */
export function sampleItems(): Item[] {
	const all = buildItems();
	return [...all.filter((i) => (i.discussion as unknown[] | undefined)?.length), ...all.filter((i) => !i.discussion).slice(0, 300)];
}

/** Every migration, in the order they apply. */
export const migrations = () => migrationsIn(MIGRATIONS);

/** A new database with no schema. */
export const emptyDb = () => new PGlite({ extensions: { vector } });

/** A new database with every migration applied. */
export async function migratedDb(): Promise<PGlite> {
	const db = emptyDb();
	for (const m of migrations()) await db.exec(m.sql);
	return db;
}

/** Hands `db` to every route, as lib/db.ts's per-process cache would; with none, routes open their own again. */
export function useDb(db?: unknown) {
	const cache = globalThis as { openIndexDb?: Promise<unknown> };
	if (db === undefined) delete cache.openIndexDb;
	else cache.openIndexDb = Promise.resolve(db);
}

/** Lets tests import route modules: outside Next, Node finds 'next/server' only by its file name. */
export const allowRouteImports = () => registerHooks({ resolve: (name, ctx, next) => next(name === 'next/server' ? 'next/server.js' : name, ctx) });
