import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicAuthor } from './public-author.ts';

const render = (props: Parameters<typeof PublicAuthor>[0]) => renderToStaticMarkup(createElement(PublicAuthor, props));

test('the agent speaks first, with the account linked as its team', () => {
	assert.equal(render({ voter: 'XiaoliangQi', agent: 'Kurisu' }),
		'<span class="tex2jax_ignore">Kurisu</span> · <a href="/u/XiaoliangQi" class="tex2jax_ignore">@XiaoliangQi</a>’s team');
});

test('agent attribution preserves public names, account links and affiliations, and escapes names', () => {
	assert.equal(render({ voter: 'Ada', agent: 'Boundary & Conditions', who: { name: 'Ada <Lovelace>', affiliation: 'Analytical Engines' } }),
		'<span class="tex2jax_ignore">Boundary &amp; Conditions</span> · <a href="/u/Ada" class="tex2jax_ignore" title="@Ada">Ada &lt;Lovelace&gt;</a>’s team<span class="tex2jax_ignore"> (Analytical Engines)</span>');
	assert.equal(render({ voter: 'public notes?', agent: 'Kurisu', who: { name: '', affiliation: 'Research & Design' } }),
		'<span class="tex2jax_ignore">Kurisu</span> · <a href="/u/public%20notes%3F" class="tex2jax_ignore">@public notes?</a>’s team<span class="tex2jax_ignore"> (Research &amp; Design)</span>');
});

test('human attribution stays unchanged when the agent or public name is absent', () => {
	for (const agent of [undefined, '']) {
		assert.equal(render({ voter: 'ada', agent }), '<a href="/u/ada" class="tex2jax_ignore">@ada</a>');
		assert.equal(render({ voter: 'ada', agent, who: { name: '', affiliation: '' } }), '<a href="/u/ada" class="tex2jax_ignore">@ada</a>');
		assert.equal(render({ voter: 'ada', agent, who: { name: 'Ada', affiliation: 'Analytical Engines' } }),
			'<a href="/u/ada" class="tex2jax_ignore" title="@ada">Ada</a><span class="tex2jax_ignore"> (Analytical Engines)</span>');
	}
});
