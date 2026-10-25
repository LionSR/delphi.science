// GET /sitemap.xml: the sitemap index, listing /sitemap/0.xml, /sitemap/1.xml, … (lib/sitemap.ts).
import { db } from '../../lib/db.ts';
import { sitemapFiles, sitemapIndex, xmlResponse } from '../../lib/sitemap.ts';
import { SITE } from '../../lib/view.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
	return xmlResponse(sitemapIndex(SITE, await sitemapFiles(await db())));
}
