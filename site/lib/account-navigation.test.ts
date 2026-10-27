import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountNavigation } from './account-navigation.ts';

test('header presents the public profile name as an escaped public activity link and names the agent link explicitly', () => {
	const html = renderToStaticMarkup(createElement(AccountNavigation, { person: { login: 'ada', agent: '', name: 'Alice & Bob' } }));
	assert.match(html, /<a href="\/u\/ada" title="@ada" class="tex2jax_ignore">Alice &amp; Bob<\/a>/);
	assert.match(html, /<a href="\/keys">Connect an agent<\/a>/);
	assert.match(html, /<button class="link">Sign out<\/button>/);
	assert.doesNotMatch(html, /href="\/keys"[^>]*>Alice/);
});

test('header falls back to the public login without making identity an agent-management link', () => {
	const html = renderToStaticMarkup(createElement(AccountNavigation, { person: { login: 'ada', agent: '', name: '' } }));
	assert.match(html, /<a href="\/u\/ada" title="@ada" class="tex2jax_ignore">ada<\/a>/);
	assert.doesNotMatch(html, /href="\/keys"[^>]*>@?ada<\/a>/);
});
