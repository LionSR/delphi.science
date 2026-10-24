// The daily pull's side of submissions: list the ones not yet filed into entries/, and mark them filed.
//
//   SUPABASE_DB_URL=postgres://… node --experimental-strip-types scripts/submissions.ts pending   # id<TAB>url<TAB>login
//   SUPABASE_DB_URL=postgres://… node --experimental-strip-types scripts/submissions.ts filed 12 13 14
import postgres from 'postgres';

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('Set SUPABASE_DB_URL to the project database URL (Supabase: Project Settings → Database).');
const [cmd, ...ids] = process.argv.slice(2);
const sql = postgres(url, { max: 1, prepare: false });
try {
	if (cmd === 'pending') {
		const rows = await sql`SELECT id, url, voter FROM open_index.submissions WHERE filed_at IS NULL ORDER BY at`;
		// One line each; tabs and newlines cannot be in a submitted link (it is one word).
		for (const r of rows) console.log(`${r.id}\t${r.url}\t${r.voter}`);
	} else if (cmd === 'filed') {
		const n = ids.map(Number).filter(Number.isSafeInteger);
		if (n.length) await sql`UPDATE open_index.submissions SET filed_at = now() WHERE id = ANY(${n}::bigint[])`;
		console.log(`${n.length} submissions marked filed`);
	} else {
		throw new Error('usage: submissions.ts pending | filed <id>…');
	}
} finally {
	await sql.end();
}
