// GET /sitemap.xml: the sitemap index.
import { counted } from '../../lib/api/caller.ts';
import { db } from '../../lib/db.ts';
import { sitemapFiles, sitemapIndex, xmlResponse } from '../../lib/records/sitemap.ts';
import { SITE } from '../../lib/view.ts';

export const dynamic = 'force-dynamic';

export const GET = counted('GET /sitemap.xml', async () => xmlResponse(sitemapIndex(SITE, await sitemapFiles(await db()))));
