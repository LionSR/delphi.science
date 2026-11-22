// GET /sitemap/<n>.xml: one sitemap file; /sitemap.xml lists them.
import { counted } from '#lib/api/caller.ts';
import { db } from '#lib/db.ts';
import { sitemapFile, sitemapFiles, urlset, xmlResponse } from '#lib/records/sitemap.ts';
import { SITE } from '#lib/view.ts';

export const dynamic = 'force-dynamic';

export const GET = counted('GET /sitemap/{file}', async (_: Request, { params }: { params: Promise<{ file: string }> }) => {
	const m = (await params).file.match(/^(\d+)\.xml$/);
	const notFound = () => new Response('Not Found: /sitemap.xml lists the sitemap files.\n', { status: 404 });
	if (!m) return notFound();
	const pg = await db();
	if (+m[1] >= (await sitemapFiles(pg))) return notFound();
	return xmlResponse(urlset(await sitemapFile(pg, SITE, +m[1])));
});
