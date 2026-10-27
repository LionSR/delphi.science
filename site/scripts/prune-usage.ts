// No production credentials are needed for development/tests. The scheduled job reuses the existing
// database secret, and prints only a completion message (never the URL, rows, queries or errors).
import postgres from 'postgres';
import { pruneUsage } from '../lib/usage.ts';

let sql: ReturnType<typeof postgres> | undefined;
try {
	const url = process.env.SUPABASE_DB_URL;
	if (!url) throw new Error('Missing database configuration.');
	const connection = sql = postgres(url, { prepare: false, max: 1 });
	await pruneUsage({ query: async (text, params = []) => ({ rows: await connection.unsafe(text, params as never[]) as never[] }) });
	console.log('Usage retention cleanup completed.');
} catch {
	console.error('Usage retention cleanup failed. Check database connectivity and migration status.');
	process.exitCode = 1;
} finally { await sql?.end(); }
