// GET /txt/<path>: the text form of a record, a forum topic or a post (lib/api/text.ts). Pages link to it as
// rel="alternate" under their own address with .txt added: /r/arxiv/2610.20058.txt, /forum/12.txt,
// /forum/12/502.txt (next.config.ts rewrites those here).
import { db } from '#lib/db.ts';
import { counted, handle } from '#lib/api/caller.ts';
import { FORUM } from '#lib/api/cache.ts';
import { pathText } from '#lib/api/text.ts';

export const GET = counted('GET /txt/{id}', (_req: Request, ctx: { params: Promise<{ id: string[] }> }) => handle(async () =>
	new Response(await pathText(await db(), (await ctx.params).id.map(decodeURIComponent).join('/')), { headers: { ...FORUM, 'Content-Type': 'text/plain; charset=utf-8' } })));
