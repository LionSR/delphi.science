// Loads dist/index.json into Supabase Postgres, writing only new and changed records (lib/load.ts).
//
//   SUPABASE_DB_URL=postgres://… node --experimental-strip-types scripts/load-open-index.ts [path/to/index.json]
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { load } from '../lib/load.ts';

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('Set SUPABASE_DB_URL to the project database URL (Supabase: Project Settings → Database).');
const path = process.argv[2] ?? new URL('../../dist/index.json', import.meta.url).pathname;

const sql = postgres(url, { max: 1, prepare: false });
const db = { query: async <T,>(text: string, params: unknown[] = []) => ({ rows: (await sql.unsafe(text, params as never[])) as unknown as T[] }) };
try {
	const { items } = JSON.parse(readFileSync(path, 'utf8'));
	console.log(`${await load(db, items)} of ${items.length} records written`);
} finally {
	await sql.end();
}
