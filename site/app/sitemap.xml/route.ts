// GET /sitemap.xml: the sitemap index, listing /sitemap/0.xml, /sitemap/1.xml, … (lib/sitemap.ts).
import { counted } from '../../lib/api.ts';
import { db } from '../../lib/db.ts';
import { sitemapFiles, sitemapIndex, xmlResponse } from '../../lib/sitemap.ts';
import { SITE } from '../../lib/view.ts';

export const dynamic = 'force-dynamic';

export const GET = counted('GET /sitemap.xml', async () => xmlResponse(sitemapIndex(SITE, await sitemapFiles(await db()))));
