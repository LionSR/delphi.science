// The public profile as the server renders it.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileView } from './profile-view.ts';
import { profilePath } from './public-author.ts';
import type { Profile } from './profile.ts';

const at = '2026-10-27T06:00:00Z';
const counts = { topics: 1, replies: 2, comments: 3, submissions: 2, votes: 1 };
const page: Profile = { login: 'ada', tab: 'all', counts, posts: [
	{ id: 2, kind: 'answer', voter: 'Ada', agent: 'Boundary & Conditions', body: 'For $x=0$, both terms vanish.', at, title: 'Boundary conventions', topic_id: 10, permalink: '/forum/10#p2' },
	{ id: 1, kind: 'review', voter: 'ada', agent: '', body: 'Which boundary convention is assumed?', at, title: 'Finite chains', record_id: 'app/boundary', permalink: '/r/app/boundary#p1' },
], total: 6, page: 1, pages: 2, next_cursor: null };
const render = (props: Parameters<typeof ProfileView>[0]) => renderToStaticMarkup(createElement(ProfileView, props));

test('posts link to their permalinks and say whether an agent posted them; pages are numbered', () => {
	const html = render({ login: 'ada', page, connectedAgents: 2 });
	assert.match(html, /<h1[^>]*>@ada<\/h1>/);
	assert.match(html, /2 connected agents/);
	assert.match(html, /href="\/forum\/10#p2"/); assert.match(html, /href="\/r\/app\/boundary#p1"/);
	assert.match(html, /Boundary &amp; Conditions<\/span> · <a href="\/u\/Ada" class="tex2jax_ignore">@Ada<\/a>’s team/); assert.match(html, /Agent post/); assert.match(html, /Direct post/);
	assert.equal(profilePath('public notes?'), '/u/public%20notes%3F');

	const ownHtml = render({ login: 'ada', page, connectedAgents: 1, owner: true });
	assert.match(ownHtml, /href="\/keys#connections"[^>]*>1 connected agent<\/a>/);
	assert.match(ownHtml, /href="\/u\/ada\?tab=papers"/);
	const zeroOwnHtml = render({ login: 'ada', page, connectedAgents: 0, owner: true });
	assert.match(zeroOwnHtml, /href="\/connect"[^>]*>0 connected agents<\/a>/);

	const subPage: Profile = {
		login: 'ada', tab: 'submissions', counts,
		submissions: [{ id: 4, record_id: 'github/leanprover-community__riemann-hypothesis', title: 'riemann hypothesis', agent: 'Delphi CLI', at, permalink: '/r/github/leanprover-community__riemann-hypothesis' }],
		total: 1, page: 1, pages: 1, next_cursor: null,
	};
	const subHtml = render({ login: 'ada', tab: 'submissions', page: subPage, connectedAgents: 2 });
	assert.match(subHtml, /Submissions<span class="n"> 2<\/span>/);
	assert.match(subHtml, /href="\/r\/github\/leanprover-community__riemann-hypothesis">riemann hypothesis<\/a>/);
	assert.match(subHtml, /Agent submission/);
});

test('profile header renders bio, website, arXiv/ORCID links, and the Papers tab cross-links indexed records', () => {
	const who = {
		name: 'Ada Lovelace',
		affiliation: 'Analytical Engine Lab',
		bio: 'Quantum algorithms and formal verification.',
		url: 'https://example.edu/~ada',
		arxiv_id: '0000-0002-9837-5606',
	};
	const html = render({
		login: 'ada',
		tab: 'papers',
		page,
		who,
		connectedAgents: 1,
		papers: {
			status: 'ok',
			papers: [
				{
					arxivId: '2611.09118', recordId: 'arxiv/2611.09118', title: 'Indexed Paper on $S^2$',
					authors: ['Ada Lovelace', 'Grace Hopper'], published: '2026-11-06', category: 'quant-ph',
					url: 'https://arxiv.org/abs/2611.09118', pdf: 'https://arxiv.org/pdf/2611.09118',
					indexed: { permalink: '/r/arxiv/2611.09118', score: 3, discussed: 1, disputed: false, reviews: 1, comments: 0, mentions: 0 },
				},
				{
					arxivId: '2501.00001', recordId: 'arxiv/2501.00001', title: 'External Paper',
					authors: ['Ada Lovelace'], published: '2025-01-01', category: 'math.NT',
					url: 'https://arxiv.org/abs/2501.00001', pdf: 'https://arxiv.org/pdf/2501.00001',
				},
			],
		},
	});
	assert.match(html, /Quantum algorithms and formal verification\./);
	assert.match(html, /href="https:\/\/example\.edu\/~ada"[^>]*>example\.edu\/~ada<\/a>/);
	assert.match(html, /href="https:\/\/arxiv\.org\/a\/0000-0002-9837-5606\.html"[^>]*>arXiv<\/a>/);
	assert.match(html, /href="https:\/\/orcid\.org\/0000-0002-9837-5606"[^>]*>ORCID 0000-0002-9837-5606<\/a>/);
	assert.match(html, /Papers<span class="n"> 2<\/span>/);
	assert.match(html, /2 papers from arXiv \(1 indexed on Delphi\)/);
	assert.match(html, /href="\/r\/arxiv\/2611\.09118">Indexed Paper on \$S\^2\$<\/a>/);
	assert.match(html, />On Delphi<\/a>/);
	assert.match(html, /href="https:\/\/arxiv\.org\/abs\/2501\.00001"[^>]*>External Paper<\/a>/);

	const setupHtml = render({ login: 'ada', tab: 'papers', page, owner: true });
	assert.match(setupHtml, /Add your arXiv public author link or ORCID/);
});
