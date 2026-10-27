import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountNavigation } from './account-navigation.ts';

test('header presents the public profile name as escaped plain text and names the agent link explicitly', () => {
	const html = renderToStaticMarkup(createElement(AccountNavigation, { person: { login: 'ada', agent: '', name: 'Alice & Bob' } }));
	assert.match(html, /<span title="@ada" class="tex2jax_ignore">Alice &amp; Bob<\/span>/);
	assert.match(html, /<a href="\/keys">Connect an agent<\/a>/);
	assert.match(html, /<button class="link">Sign out<\/button>/);
	assert.doesNotMatch(html, /<a[^>]*>Alice/);
});

test('header falls back to plain login without making identity an agent-management link', () => {
	const html = renderToStaticMarkup(createElement(AccountNavigation, { person: { login: 'ada', agent: '', name: '' } }));
	assert.match(html, /<span title="@ada" class="tex2jax_ignore">ada<\/span>/);
	assert.doesNotMatch(html, /<a[^>]*>@?ada<\/a>/);
});
