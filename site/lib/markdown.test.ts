import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, mathDelimiters } from './markdown.ts';

const render = (text: string, postId = 1) => renderToStaticMarkup(createElement(Markdown, { text, postId }));

test('MathJax renders inline/display dollar and backslash delimiters, including aligned equations', () => {
	for (const text of ['$x^2+1$', '\\(x^2+1\\)', '$$\nx^2+1\n$$', '\\[x^2+1\\]', '$$\n\\begin{aligned}a&=b\\\\c&=d\\end{aligned}\n$$']) {
		const html = render(text);
		assert.match(html, /<mjx-container[^>]+jax="SVG"/, text);
	}
	assert.match(render('before \\[x^2\\] after'), /display="true"/);
});

test('backslash normalization leaves code, escaped delimiters and URL destinations literal', () => {
	for (const text of ['`\\(x\\)`', '```tex\n\\[x\\]\n```', '    \\(x\\)', '\\\\(x\\\\)', '[source](https://example.org/\\(x\\))', 'www.example.org/\\(x\\)', '\\(unclosed\n\n```tex\nx\n```\n\n\\)']) assert.equal(mathDelimiters(text), text);
	assert.match(render('```python\n$z$ \\(x\\) <value>\n```'), /&lt;value&gt;/);
	assert.doesNotMatch(render('```python\n$z$ \\(x\\)\n```'), /<mjx-container/);
	assert.match(render('[value \\(x\\)](https://example.org/)'), /<mjx-container/);
});

test('backslash math preserves embedded TeX dollars and list/blockquote containers', () => {
	const price = render('price \\(\\text{\\$5}\\) after');
	assert.doesNotMatch(price, /Missing close brace|5\}\$/);
	assert.match(price, /<mjx-container/);
	for (const [prefix, tag] of [['- ', 'li'], ['> ', 'blockquote']]) {
		const html = render(`${prefix}before \\[x^2\\] after`);
		assert.match(html, new RegExp(`<${tag}[^>]*>[\\s\\S]*before[\\s\\S]*<mjx-container[\\s\\S]*after[\\s\\S]*<\\/${tag}>`));
	}
	assert.ok(render('www.example.org/\\(x\\)').includes('href="http://www.example.org/%5C(x%5C)"'));
});

test('ordinary images remain links without fetching external assets', () => {
	const html = render('![plot](https://example.org/plot.png)');
	assert.doesNotMatch(html, /<img/);
	assert.match(html, /href="https:\/\/example.org\/plot.png"/);
});

test('malformed Markdown/TeX remain bounded and preserve surrounding prose', () => {
	for (const text of ['before $\\frac{a}{$ after', 'before \\(unclosed after', 'before **unclosed [x]( after']) {
		const html = render(text);
		assert.ok(html.includes('before'));
		assert.ok(html.includes('after'));
		assert.ok(html.length < 100000);
	}
});

test('equation tags and references cannot collide or resolve into a different post', () => {
	const text = '$$\nx=1\\tag{X}\\label{label}\n$$\n\nSee $\\eqref{label}$.';
	const a = render(text, 10), b = render(text, 11);
	const ids = [...(a + b).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
	assert.equal(new Set(ids).size, ids.length);
	for (const html of [a, b]) {
		const own = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
		const refs = [...html.matchAll(/(?:href|xlink:href)="#([^"]+)"/g)].map((m) => m[1]);
		assert.ok(refs.length > 0);
		for (const ref of refs) assert.ok(own.has(ref), `reference ${ref} is not local to its post`);
	}
	assert.ok(render('[platform anchor](#p6)', 12).includes('href="#p6"'), 'ordinary Markdown anchors retain their meaning');
});
