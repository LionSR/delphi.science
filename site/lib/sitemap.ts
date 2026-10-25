// The sitemap: an index at /sitemap.xml (app/sitemap.xml/route.ts) that lists numbered files at /sitemap/<n>.xml
// (app/sitemap/[file]/route.ts). The protocol allows 50,000 URLs a file and the index holds ~85,000 records, so
// they are split by id, in order, and every record is in exactly one file. The first file also carries the
// site's own pages, so each file holds fewer records than the limit.
//
// These are route handlers, not Next.js's sitemap.ts with generateSitemaps: that serves /sitemap/<n>.xml but no
// index, and it claims /sitemap.xml, so an index there fails the build ("Conflicting route and metadata").
import type { Db } from './query.ts';
import { recordPath } from './view.ts';

export const MAX_URLS = 50_000;
export const PAGES = ['', '/keys']; // the site's own pages, in the first file
export const RECORDS_PER_FILE = MAX_URLS - 1_000; // room for PAGES, and pages added later

export type Url = { loc: string; lastmod?: string };

/** How many files the records need: at least one, for the site's own pages. */
export const fileCount = (records: number) => Math.max(1, Math.ceil(records / RECORDS_PER_FILE));

export async function sitemapFiles(db: Db): Promise<number> {
	const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM open_index.records');
	return fileCount(Number(rows[0].n));
}

const iso = (when: unknown) => (when instanceof Date ? when.toISOString() : new Date(String(when)).toISOString());

/** File n: its slice of the records by id (the primary key, so slices do not overlap), each with its last change. */
export async function sitemapFile(db: Db, site: string, n: number): Promise<Url[]> {
	const { rows } = await db.query<{ id: string; updated_at: string | Date }>(
		'SELECT id, updated_at FROM open_index.records ORDER BY id LIMIT $1 OFFSET $2', [RECORDS_PER_FILE, n * RECORDS_PER_FILE]);
	const records = rows.map((r) => ({ loc: `${site}${recordPath(r.id)}`, lastmod: iso(r.updated_at) }));
	return n === 0 ? [...PAGES.map((p) => ({ loc: `${site}${p}` })), ...records] : records;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
const entry = (tag: string, u: Url) => `<${tag}><loc>${escape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</${tag}>`;

/** One sitemap file (sitemaps.org/protocol.html). */
export const urlset = (urls: Url[]) => `${XML}<urlset ${NS}>\n${urls.map((u) => entry('url', u)).join('\n')}\n</urlset>\n`;

/** The sitemap index (sitemaps.org/protocol.html#index): one <sitemap> per file. */
export const sitemapIndex = (site: string, files: number) =>
	`${XML}<sitemapindex ${NS}>\n${Array.from({ length: files }, (_, n) => entry('sitemap', { loc: `${site}/sitemap/${n}.xml` })).join('\n')}\n</sitemapindex>\n`;

export const xmlResponse = (body: string) =>
	new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
