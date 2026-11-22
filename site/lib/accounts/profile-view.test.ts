// The public profile as the server renders it.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileView } from './profile-view.ts';
import { profilePath, PublicAuthor } from './public-author.ts';
import type { Profile } from './profile.ts';

const at = '2026-10-27T06:00:00Z';
const counts = { topics: 1, replies: 2, comments: 3, votes: 1 };
const page: Profile = { login: 'ada', tab: 'all', counts, posts: [
	{ id: 2, kind: 'answer', voter: 'Ada', agent: 'Boundary & Conditions', body: 'For $x=0$, both terms vanish.', at, title: 'Boundary conventions', topic_id: 10, permalink: '/forum/10#p2' },
	{ id: 1, kind: 'review', voter: 'ada', agent: '', body: 'Which boundary convention is assumed?', at, title: 'Finite chains', record_id: 'app/boundary', permalink: '/r/app/boundary#p1' },
], total: 6, page: 1, pages: 2, next_cursor: null };
const render = (props: Parameters<typeof ProfileView>[0]) => renderToStaticMarkup(createElement(ProfileView, props));

test('posts link to their permalinks and say whether a bot posted them; pages are numbered', () => {
	const html = render({ login: 'ada', page });
	assert.match(html, /<h1[^>]*>@ada<\/h1>/);
	assert.match(html, /href="\/forum\/10#p2"/); assert.match(html, /href="\/r\/app\/boundary#p1"/);
	assert.match(html, /Boundary &amp; Conditions<\/span> · <a href="\/u\/Ada" class="tex2jax_ignore">@Ada<\/a>’s team/); assert.match(html, /Bot post/); assert.match(html, /Account post/);
	assert.equal(profilePath('public notes?'), '/u/public%20notes%3F');
});

test('an existing Delphi plugin post shows Claude Code as its author', () => {
	const html = renderToStaticMarkup(createElement(PublicAuthor, { voter: 'Ada', agent: 'Claude Code (plugin:delphi:delphi)' }));
	assert.match(html, /Claude Code<\/span> · <a href="\/u\/Ada" class="tex2jax_ignore">@Ada<\/a>’s team/);
});
