// Web intake and the bounded HTTPS transport, with scripted responses; no network.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { boundedHttps, publicWebTarget, readPublicWeb, RetrievalError, SourceInputError, webKey, type SourceTransport } from './source-fetch.ts';

const url = 'https://blog.example.org/posts/open-chains/';
const bytes = (value: string) => new TextEncoder().encode(value);
const page = (body: string, type = 'text/html; charset=utf-8'): SourceTransport =>
	async (t) => ({ status: 200, url: t.requestUrl, headers: { 'content-type': type }, body: bytes(body) });
const wire = (status: number, headers: Record<string, string>, chunks: Uint8Array[] = []) =>
	({ status, headers, body: (async function* () { yield* chunks; })() });
const dns = async () => ['8.8.8.8'];

test('an HTML page is read into title, summary, authors and date', async () => {
	const html = `<html><head><title>Fallback &amp; title</title>
		<meta name="citation_title" content="Open chains">
		<meta name="citation_author" content="Ada Example"><meta name="citation_author" content="Bo Sample">
		<meta name="description" content="Which endpoint terms remain.">
		<meta name="citation_publication_date" content="2026/02/03">
		</head><body><script>ignored()</script><p>Body text.</p></body></html>`;
	assert.deepEqual(await readPublicWeb(url, page(html)), {
		source: 'web', key: webKey(url), url, title: 'Open chains', authors: ['Ada Example', 'Bo Sample'],
		summary: 'Which endpoint terms remain.', published: '2026-02-03',
	});
	const plain = await readPublicWeb(url, page('<title>Fallback &amp; title</title><p>Body text.</p>'));
	assert.equal(plain.title, 'Fallback & title');
	assert.equal(plain.summary, 'Fallback & title Body text.');
});

test('a page that is not HTML, or not found, is refused', async () => {
	await assert.rejects(readPublicWeb(url, page('%PDF-1.7', 'application/pdf')), (e) => e instanceof RetrievalError && e.status === 'unsupported_format');
	await assert.rejects(readPublicWeb(url, async (t) => ({ status: 404, url: t.requestUrl, headers: {}, body: new Uint8Array() })),
		(e) => e instanceof RetrievalError && e.status === 'not_found');
});

test('non-https, credentialed, IP, local and adapter-owned targets are refused', () => {
	for (const input of ['http://blog.example.org/page', 'https://reader:secret@blog.example.org/page', 'https://blog.example.org:444/page',
		`${url}?token=secret`, 'https://127.0.0.1/page', 'https://localhost/page', 'https://intranet.internal/page', 'https://arxiv.org/abs/1706.03762']) {
		assert.throws(() => publicWebTarget(input), SourceInputError, input);
	}
});

test('a private DNS answer never reaches a socket, and the socket is pinned to the checked address', async () => {
	let sockets = 0;
	for (const ips of [['127.0.0.1'], ['8.8.8.8', '10.0.0.1'], []]) {
		await assert.rejects(boundedHttps(publicWebTarget(url), { resolve4: async () => ips, connect: async () => { sockets++; return wire(200, {}); } }));
	}
	assert.equal(sockets, 0);
	const got = await boundedHttps(publicWebTarget(url), {
		resolve4: dns,
		connect: async (options) => {
			const address = await new Promise((resolve) => options.lookup('blog.example.org', {}, (_error, found) => resolve(found)));
			assert.equal(address, '8.8.8.8');
			assert.equal(options.servername, 'blog.example.org');
			return wire(200, { 'content-type': 'text/html' }, [bytes('<title>ok</title>')]);
		},
	});
	assert.equal(new TextDecoder().decode(got.body), '<title>ok</title>');
});

test('a same-origin redirect is followed and a cross-origin one is refused', async () => {
	const paths: string[] = [];
	await boundedHttps(publicWebTarget(url), {
		resolve4: dns,
		connect: async (options) => { paths.push(String(options.path)); return paths.length === 1 ? wire(302, { location: '/moved' }) : wire(200, {}, [bytes('ok')]); },
	});
	assert.deepEqual(paths, ['/posts/open-chains/', '/moved']);
	for (const location of ['https://other.example.org/page', 'http://blog.example.org/page', 'https://127.0.0.1/private']) {
		let hops = 0;
		await assert.rejects(boundedHttps(publicWebTarget(url), { resolve4: dns, connect: async () => { hops++; return wire(302, { location }); } }), /redirected outside/);
		assert.equal(hops, 1);
	}
});

test('a response over the byte cap is refused, declared or streamed', async () => {
	const big = new Uint8Array(200_000);
	await assert.rejects(boundedHttps(publicWebTarget(url), { resolve4: dns, connect: async () => wire(200, {}, [big, big]) }), /byte limit/);
	await assert.rejects(boundedHttps(publicWebTarget(url), { resolve4: dns, connect: async () => wire(200, { 'content-length': '400000' }) }), /byte limit/);
});
