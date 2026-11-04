// GET /api/v1/search?q=…: arXiv-style search (searchRecords). JSON, or a Markdown list with format=md.
import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { search } from '#lib/records/query.ts';
import { RECORDS } from '#lib/api/cache.ts';

export const GET = operation('searchRecords', async ({ query }) => {
	const res = await search(await db(), query.q ?? '', { limit: query.limit, cursor: query.cursor, sort: query.sort, fields: query.fields });
	if (query.format !== 'md') return Response.json(res, { headers: RECORDS });
	const lines = res.results.map((r) => `- [${r.title}](${r.url}) ${r.id} · ${r.published ?? ''} · ${r.subject ?? ''} · score ${r.score ?? 0}`);
	const more = res.next_cursor ? `\nMore: &cursor=${res.next_cursor}` : '';
	return new Response(`${res.total} results for \`${res.query}\`\n\n${lines.join('\n')}\n${more}`, {
		headers: { ...RECORDS, 'Content-Type': 'text/markdown; charset=utf-8' },
	});
});
