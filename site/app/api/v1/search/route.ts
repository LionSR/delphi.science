// GET /api/v1/search?q=…: arXiv-style search (searchRecords). JSON, or a Markdown list with format=md.
import { db } from '#lib/db.ts';
import { operation } from '#lib/api/operation.ts';
import { isGroupedWork, mainRecordOf, workOf, workTitleOf } from '#lib/records/work-groups.ts';
import { search } from '#lib/records/query.ts';
import { RECORDS } from '#lib/api/cache.ts';

export const GET = operation('searchRecords', async ({ query }) => {
	const res = await search(await db(), query.q ?? '', query);
	if (query.format !== 'md') return Response.json(res, { headers: RECORDS });
	const lines = res.results.map((r) => {
		const work = workOf(r);
		const main = mainRecordOf(r);
		if (!work || !isGroupedWork(r)) return `- [${r.title}](${r.url}) ${r.id} · ${r.published ?? ''} · ${r.subject ?? ''} · score ${r.score ?? 0}`;
		return `- [${workTitleOf(r)}](${main.url}) · main record ${work.main_record_id}${main.id === work.main_record_id ? '' : ' (currently unavailable; showing alternative)'} · one work, ${work.discussed} distinct external responses; interactions are source-bound\n` +
			work.sources.map((s) => `  - ${s.id === work.main_record_id ? 'Main record' : 'Alternative source'} (${s.role}): [${s.id}](${s.record.url}) · ${s.date_meaning}: ${s.record.published ?? 'not stated'} · score ${s.record.score ?? 0}`).join('\n');
	});
	const more = res.next_cursor ? `\nMore: &cursor=${res.next_cursor}` : '';
	return new Response(`${res.total} results for \`${res.query}\`, page ${res.page} of ${res.pages}\n\n${lines.join('\n')}\n${more}`, {
		headers: { ...RECORDS, 'Content-Type': 'text/markdown; charset=utf-8' },
	});
});
