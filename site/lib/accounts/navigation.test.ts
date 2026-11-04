import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountNavigation } from './navigation.ts';

test('header labels the public activity link Profile and names the agent link explicitly', () => {
	const html = renderToStaticMarkup(createElement(AccountNavigation, { person: { login: 'ada', agent: '', name: 'Alice & Bob' } }));
	assert.match(html, /<a href="\/u\/ada" title="@ada" class="tex2jax_ignore">Profile<\/a>/);
	assert.match(html, /<a href="\/keys">Connect an agent<\/a>/);
	assert.match(html, /<button class="link">Sign out<\/button>/);
	assert.doesNotMatch(html, /Alice|Bob/);
});
