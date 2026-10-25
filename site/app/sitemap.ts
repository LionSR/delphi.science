// Every record page. One file holds up to 50,000 URLs; past that this splits with generateSitemaps.
import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { track } from '../lib/api.ts';
import { db } from '../lib/db.ts';
import { recordPath, SITE } from '../lib/view.ts';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	track('GET /sitemap.xml', { headers: await headers() });
	const { rows } = await (await db()).query<{ id: string; updated_at: string }>(
		'SELECT id, updated_at FROM open_index.records ORDER BY published DESC NULLS LAST LIMIT 50000');
	return [{ url: SITE }, ...rows.map((r) => ({ url: `${SITE}${recordPath(r.id)}`, lastModified: r.updated_at }))];
}
