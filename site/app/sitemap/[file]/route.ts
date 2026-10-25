// GET /sitemap/<n>.xml: one sitemap file, with the site's pages (in the first) and a slice of the record pages,
// each with the time it last changed (lib/sitemap.ts). /sitemap.xml lists them.
import { counted } from '../../../lib/api.ts';
import { db } from '../../../lib/db.ts';
import { sitemapFile, sitemapFiles, urlset, xmlResponse } from '../../../lib/sitemap.ts';
import { SITE } from '../../../lib/view.ts';

export const dynamic = 'force-dynamic';

export const GET = counted('GET /sitemap/{file}', async (_: Request, { params }: { params: Promise<{ file: string }> }) => {
	const m = (await params).file.match(/^(\d+)\.xml$/);
	const pg = await db();
	if (!m || +m[1] >= (await sitemapFiles(pg))) return new Response('Not Found: /sitemap.xml lists the sitemap files.\n', { status: 404 });
	return xmlResponse(urlset(await sitemapFile(pg, SITE, +m[1])));
});
