// A throwaway Postgres server (PGlite with all migrations) for index.py, used by test_index.py and CI.
// Prints its URL on the first line and serves until stopped.
//
//   node --experimental-strip-types scripts/db.ts [--entries ../fixtures/entries.jsonl]
//   SUPABASE_DB_URL=<the URL it prints> python3 index.py build
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const { values } = parseArgs({ options: { entries: { type: 'string' } } });
const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);

const db = new PGlite({ extensions: { vector } });
for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
if (values.entries) {
	// JSON lines, as store.py keeps them; the id is <source>/<key>.
	const entries = readFileSync(values.entries, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
	await db.query(`INSERT INTO open_index.entries (id, entry) SELECT e->>'source' || '/' || (e->>'key'), e FROM jsonb_array_elements($1::jsonb) e`,
		[JSON.stringify(entries)]);
}

// A free port, picked by the OS.
const port = await new Promise<number>((done) => {
	const probe = createServer().listen(0, '127.0.0.1', () => {
		const { port } = probe.address() as { port: number };
		probe.close(() => done(port));
	});
});
// Any password is accepted; the URL includes one because clients expect it.
await new PGLiteSocketServer({ db, port, host: '127.0.0.1' }).start();
console.log(`postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`);
