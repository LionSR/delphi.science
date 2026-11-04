// The sitemap index at /sitemap.xml and its files at /sitemap/<n>.xml, records split by id. Plain route
// handlers, because Next.js's generateSitemaps cannot serve an index at /sitemap.xml.
import type { Db } from '#lib/db.ts';
import { recordPath } from '#lib/view.ts';

export const MAX_URLS = 50_000;
export const PAGES = ['', '/about', '/prompts', '/keys']; // the site's own pages, in the first file
export const RECORDS_PER_FILE = MAX_URLS - 1_000; // leaves room for PAGES

type Url = { loc: string; lastmod?: string };

/** How many files the records need: at least one, for the site's own pages. */
export const fileCount = (records: number) => Math.max(1, Math.ceil(records / RECORDS_PER_FILE));

export async function sitemapFiles(db: Db): Promise<number> {
	const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM open_index.records');
	return fileCount(Number(rows[0].n));
}

/** File n: its slice of the records by id, each with its last change. */
export async function sitemapFile(db: Db, site: string, n: number): Promise<Url[]> {
	const { rows } = await db.query<{ id: string; updated_at: string | Date }>(
		'SELECT id, updated_at FROM open_index.records ORDER BY id LIMIT $1 OFFSET $2', [RECORDS_PER_FILE, n * RECORDS_PER_FILE]);
	const records = rows.map((r) => ({ loc: `${site}${recordPath(r.id)}`, lastmod: new Date(r.updated_at).toISOString() }));
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
