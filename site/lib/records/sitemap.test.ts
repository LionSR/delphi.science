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
	test('the index lists each numbered file; a file gives each URL its lastmod, escaped', () => {
		assert.match(sitemapIndex('https://x.org', 2),
			/<sitemapindex [^>]*>\n<sitemap><loc>https:\/\/x.org\/sitemap\/0.xml<\/loc><\/sitemap>\n<sitemap><loc>https:\/\/x.org\/sitemap\/1.xml<\/loc><\/sitemap>\n<\/sitemapindex>\n$/);
		assert.match(urlset([{ loc: 'https://x.org' }, { loc: 'https://x.org/r/a/b?c=1&d=2', lastmod: '2026-10-25T00:00:00.000Z' }]),
			/<urlset [^>]*>\n<url><loc>https:\/\/x.org<\/loc><\/url>\n<url><loc>https:\/\/x.org\/r\/a\/b\?c=1&amp;d=2<\/loc><lastmod>2026-10-25T00:00:00.000Z<\/lastmod><\/url>\n<\/urlset>\n$/);
	});
});
