// The sitemap's split and its XML (lib/records/sitemap.ts). That every record is listed once is checked on Postgres,
// in search.test.ts.
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { fileCount, MAX_URLS, PAGES, RECORDS_PER_FILE, sitemapIndex, urlset } from './sitemap.ts';

describe('sitemap', () => {
	test('no file holds more than 50,000 URLs, with room for the site pages', () => {
		assert.ok(RECORDS_PER_FILE + PAGES.length <= MAX_URLS);
		assert.deepEqual([fileCount(0), fileCount(RECORDS_PER_FILE), fileCount(RECORDS_PER_FILE + 1)], [1, 1, 2]);
	});
	test('the index lists each numbered file', () => {
		const xml = sitemapIndex('https://x.org', 2);
		assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<sitemapindex xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
		assert.deepEqual([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]), ['https://x.org/sitemap/0.xml', 'https://x.org/sitemap/1.xml']);
		assert.ok(xml.trimEnd().endsWith('</sitemapindex>'));
	});
	test('a file gives each URL its lastmod, and escapes the URL', () => {
		const xml = urlset([{ loc: 'https://x.org' }, { loc: 'https://x.org/r/a/b?c=1&d=2', lastmod: '2026-10-25T00:00:00.000Z' }]);
		assert.match(xml, /<url><loc>https:\/\/x.org<\/loc><\/url>/);
		assert.match(xml, /<url><loc>https:\/\/x.org\/r\/a\/b\?c=1&amp;d=2<\/loc><lastmod>2026-10-25T00:00:00.000Z<\/lastmod><\/url>/);
	});
});
