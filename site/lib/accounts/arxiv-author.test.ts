// arXiv public author identifier validation, Atom2 parsing, and cross-linking with indexed records.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { migratedDb } from '#lib/testing.ts';
import { load } from '#lib/records/load.ts';
import { arxivAuthorFeedUrl, arxivAuthorUrl, fetchArxivAuthorPapers, isOrcid, normalizeArxivAuthor, orcidUrl, parseArxivAuthorFeed } from './arxiv-author.ts';

let db: PGlite;
before(async () => {
	db = await migratedDb();
});
after(() => db.close());

test('normalizeArxivAuthor accepts arXiv author URLs/IDs and ORCID URLs/IDs, and rejects unsafe or invalid inputs', () => {
	assert.equal(normalizeArxivAuthor(''), '');
	assert.equal(normalizeArxivAuthor('   '), '');
	assert.equal(normalizeArxivAuthor('lu_s_4'), 'lu_s_4');
	assert.equal(normalizeArxivAuthor('https://arxiv.org/a/Lu_S_4.html'), 'lu_s_4');
	assert.equal(normalizeArxivAuthor('http://arxiv.org/a/de_boer_j_1.atom2'), 'de_boer_j_1');
	assert.equal(normalizeArxivAuthor('arxiv.org/a/tao_t_1'), 'tao_t_1');
	assert.equal(normalizeArxivAuthor('0000-0002-9837-560x'), '0000-0002-9837-560X');
	assert.equal(normalizeArxivAuthor('https://orcid.org/0000-0002-9837-5606/'), '0000-0002-9837-5606');
	assert.equal(normalizeArxivAuthor('https://arxiv.org/a/0000-0002-9837-5606.html'), '0000-0002-9837-5606');

	assert.equal(isOrcid('0000-0002-9837-560X'), true);
	assert.equal(isOrcid('lu_s_4'), false);
	assert.equal(arxivAuthorUrl('lu_s_4'), 'https://arxiv.org/a/lu_s_4.html');
	assert.equal(arxivAuthorFeedUrl('lu_s_4'), 'https://arxiv.org/a/lu_s_4.atom2');
	assert.equal(orcidUrl('0000-0002-9837-5606'), 'https://orcid.org/0000-0002-9837-5606');

	for (const bad of [
		'https://arxiv.org/search/?searchtype=author&query=Tao',
		'https://evil.example/a/lu_s_4.html',
		'../secret',
		'lu_s_4?foo=bar',
		'just-a-name',
		'0000-0002-9837-560',
	]) {
		assert.throws(() => normalizeArxivAuthor(bad), /arXiv public author/i, `expected rejection for ${bad}`);
	}
});

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Author's articles on arXiv</title>
  <entry>
    <id>http://arxiv.org/abs/2611.09118v2</id>
    <published>2026-11-06T02:56:31-05:00</published>
    <title>Spin &amp;amp; Gauge
      Theories on $S^2$</title>
    <author><name>Ada Lovelace, Grace Hopper</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="quant-ph" />
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-th/0601001v1</id>
    <updated>2006-01-02T00:00:00Z</updated>
    <title>Old-Style &amp; Classic &#8212; Notes</title>
    <author><name>Ada Lovelace</name></author>
    <category term="hep-th" />
  </entry>
</feed>`;

test('parseArxivAuthorFeed strips versions, decodes XML, and splits comma-separated authors', () => {
	const papers = parseArxivAuthorFeed(SAMPLE_FEED);
	assert.equal(papers.length, 2);
	assert.deepEqual(papers[0], {
		arxivId: '2611.09118',
		recordId: 'arxiv/2611.09118',
		title: 'Spin &amp; Gauge Theories on $S^2$',
		authors: ['Ada Lovelace', 'Grace Hopper'],
		published: '2026-11-06',
		category: 'quant-ph',
		url: 'https://arxiv.org/abs/2611.09118',
		pdf: 'https://arxiv.org/pdf/2611.09118',
	});
	assert.equal(papers[1].arxivId, 'hep-th/0601001');
	assert.equal(papers[1].title, 'Old-Style & Classic — Notes');
	assert.equal(papers[1].published, '2006-01-02');
	assert.equal(papers[1].category, 'hep-th');
});

test('fetchArxivAuthorPapers enriches indexed records and handles 404/HTML/network errors', async () => {
	await load(db, [
		{
			id: 'arxiv/2611.09118', source: 'arxiv', url: 'https://arxiv.org/abs/2611.09118', title: 'Spin & Gauge Theories',
			discussion: [
				{ kind: 'web', url: 'https://example.edu/note1', stance: 'questions' },
				{ kind: 'web', url: 'https://example.edu/note2', stance: 'confirms' },
			],
		},
		{ id: 'arxiv/hep-th/0601001', source: 'arxiv', url: 'https://arxiv.org/abs/hep-th/0601001', title: 'Gone paper', gone: true },
	]);
	await db.query(`UPDATE open_index.records SET score = 4, reviews_count = 1 WHERE id = 'arxiv/2611.09118'`);

	const ok = await fetchArxivAuthorPapers(db, 'lovelace_a_1', {
		bypassCache: true,
		fetch: async () => new Response(SAMPLE_FEED, { status: 200, headers: { 'content-type': 'application/atom+xml' } }),
	});
	assert.equal(ok.status, 'ok');
	assert.equal(ok.papers.length, 2);
	assert.deepEqual(ok.papers[0].indexed, {
		permalink: '/r/arxiv/2611.09118',
		score: 4, discussed: 2, disputed: true, reviews: 1, comments: 0, mentions: 0,
	});
	assert.equal(ok.papers[1].indexed, undefined);

	const htmlNotFound = await fetchArxivAuthorPapers(db, 'missing_a_1', {
		bypassCache: true,
		fetch: async () => new Response('<html><body>Not found</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
	});
	assert.equal(htmlNotFound.status, 'not_found');

	const down = await fetchArxivAuthorPapers(db, 'down_a_1', {
		bypassCache: true,
		fetch: async () => { throw new Error('network error'); },
	});
	assert.equal(down.status, 'unavailable');
});
