// GET /api/v1/search?q=…: arXiv-style search. JSON by default; format=md for a short list to paste into context.
import { handle } from '../../../../lib/api.ts';
import { db } from '../../../../lib/db.ts';
import { search } from '../../../../lib/query.ts';

const CACHE = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' };

export const GET = (req: Request) =>
	handle(async () => {
		const p = new URL(req.url).searchParams;
		const res = await search(await db(), p.get('q') ?? '', {
			limit: Number(p.get('limit') ?? 20) || 20,
			cursor: p.get('cursor'),
			sort: p.get('sort') ?? (p.get('q') ? 'relevance' : 'newest'),
			fields: p.get('fields') === 'full' ? 'full' : 'compact',
		});
		if (p.get('format') !== 'md') return Response.json(res, { headers: CACHE });
		const lines = res.results.map((r) => `- [${r.title}](${r.url}) ${r.id} · ${r.published ?? ''} · ${r.subject ?? ''} · score ${r.score ?? 0}`);
		const more = res.next_cursor ? `\nMore: &cursor=${res.next_cursor}` : '';
		return new Response(`${res.total} results for \`${res.query}\`\n\n${lines.join('\n')}\n${more}`, {
			headers: { ...CACHE, 'Content-Type': 'text/markdown; charset=utf-8' },
		});
	});
