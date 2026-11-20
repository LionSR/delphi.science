import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './markdown.ts';

const render = (text: string, postId = 1) => renderToStaticMarkup(createElement(Markdown, { text, postId }));

test('MathJax renders inline/display dollar and backslash delimiters, including aligned equations', () => {
	for (const text of ['$x^2+1$', '\\(x^2+1\\)', '$$\nx^2+1\n$$', '\\[x^2+1\\]', '$$\n\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n$$']) {
		const html = render(text);
		assert.match(html, /<mjx-container[^>]+jax="SVG"/, text);
	}
	assert.match(render('before \\[x^2\\] after'), /display="true"/);
});

test('raw HTML and javascript: links are dropped, and images become links so no external asset is fetched', () => {
	const html = render('A **corrected** claim. <script>alert(1)</script> [bad](javascript:alert(1)) ![plot](https://example.org/plot.png)');
	assert.match(html, /<strong>corrected<\/strong>/);
	assert.doesNotMatch(html, /<script|javascript:|<img/);
	assert.match(html, /href="https:\/\/example.org\/plot.png"/);
});

