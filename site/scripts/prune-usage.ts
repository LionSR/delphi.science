// Deletes old API usage counters (usage-retention.yml). Output is deliberately generic so logs never show the URL or errors.
import postgres from 'postgres';
import { pruneUsage, retentionEnabled } from '#lib/api/usage.ts';

let sql: ReturnType<typeof postgres> | undefined;
try {
	if (!retentionEnabled()) {
		console.log('Usage retention cleanup is disabled.');
		process.exit(0);
	}
	const url = process.env.SUPABASE_DB_URL;
	if (!url) throw new Error('Missing database configuration.');
	const connection = postgres(url, { prepare: false, max: 1 });
	sql = connection;
	await pruneUsage({ query: async (text, params = []) => ({ rows: await connection.unsafe(text, params as never[]) as never[] }) });
	console.log('Usage retention cleanup completed.');
} catch {
	console.error('Usage retention cleanup failed. Check database connectivity and migration status.');
	process.exitCode = 1;
} finally {
	await sql?.end();
}
