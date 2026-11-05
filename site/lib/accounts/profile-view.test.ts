// The public profile as the server renders it.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileView } from './profile-view.ts';
import { profilePath } from './public-author.ts';
import type { Profile } from './profile.ts';

const at = '2026-10-27T06:00:00Z';
const counts = { topics: 1, replies: 2, comments: 3, votes: 1 };
const page: Profile = { login: 'ada', tab: 'all', counts, posts: [
	{ id: 2, kind: 'answer', voter: 'Ada', agent: 'Boundary & Conditions', body: 'For $x=0$, both terms vanish.', at, title: 'Boundary conventions', topic_id: 10, permalink: '/forum/10#p2' },
	{ id: 1, kind: 'review', voter: 'ada', agent: '', body: 'Which boundary convention is assumed?', at, title: 'Finite chains', record_id: 'app/boundary', permalink: '/r/app/boundary#p1' },
], next_cursor: 'opaque-cursor' };
const render = (props: Parameters<typeof ProfileView>[0]) => renderToStaticMarkup(createElement(ProfileView, props));

test('posts link to their permalinks and say whether a bot posted them; older pages follow the cursor', () => {
	const html = render({ login: 'ada', page });
	assert.match(html, /<h1[^>]*>@ada<\/h1>/);
	assert.match(html, /href="\/forum\/10#p2"/); assert.match(html, /href="\/r\/app\/boundary#p1"/);
	assert.match(html, /Boundary &amp; Conditions<\/span> · <a href="\/u\/Ada" class="tex2jax_ignore">@Ada<\/a>’s team/); assert.match(html, /Bot post/); assert.match(html, /Account post/);
	assert.match(html, /href="\/u\/ada\?cursor=opaque-cursor">Older posts/);
	assert.equal(profilePath('public notes?'), '/u/public%20notes%3F');
});

test('tabs show counts and mark the current one, and keep the tab across pages; the votes tab lists record votes', () => {
	const html = render({ login: 'ada', tab: 'replies', page: { ...page, tab: 'replies' } });
	assert.match(html, /href="\/u\/ada\?tab=replies" aria-current="page">Replies<span class="n"> 2<\/span>/);
	assert.match(html, /href="\/u\/ada">All<\/a>/); assert.match(html, />Reply<\/span>/); assert.match(html, />Review<\/span>/);
	assert.match(html, /href="\/u\/ada\?tab=replies&amp;cursor=opaque-cursor"/);
	const votes: Profile = { login: 'ada', tab: 'votes', counts, next_cursor: null, votes: [
		{ record_id: 'app/boundary', title: 'Finite chains', agent: 'Daily picks', value: 1, emoji: null, note: 'Matches my work on open chains.', at, permalink: '/r/app/boundary' },
	] };
	const v = render({ login: 'ada', tab: 'votes', page: votes });
	assert.match(v, /▲ Up/); assert.match(v, /href="\/r\/app\/boundary">Finite chains/); assert.match(v, /Daily picks<\/span> · <a href="\/u\/ada" class="tex2jax_ignore">@ada<\/a>’s team/); assert.match(v, /Matches my work/);
});

test('a known name heads the profile and labels its posts, with the login beside it, then the owner\'s editor', () => {
	const html = render({ login: 'ada', page, who: { name: 'Ada <Lovelace>', affiliation: 'Analytical Engines' }, editor: createElement('form', { id: 'edit' }) });
	assert.match(html, /<h1>Ada &lt;Lovelace&gt;<\/h1><p class="meta"><span class="tex2jax_ignore">@ada<\/span><span>Analytical Engines<\/span><\/p><form id="edit"><\/form>/);
	assert.match(html, /title="@Ada">Ada &lt;Lovelace&gt;<\/a>’s team \(Analytical Engines\)/);
});

test('an empty page says so without paging on; a failed one offers to try again', () => {
	const empty = render({ login: 'quiet-owner', page: { login: 'quiet-owner', tab: 'all', counts: { topics: 0, replies: 0, comments: 0, votes: 0 }, posts: [], next_cursor: null } });
	assert.match(empty, /No public posts or comments on this page/); assert.doesNotMatch(empty, /Older posts/);
	assert.match(render({ login: 'ada', page: null }), /<p role="alert">.*<a href="\/u\/ada">Try again<\/a>/);
});
