// Fetches public source text within size and time limits. Requests use Node's own HTTPS with the DNS lookup pinned
// to a checked public IPv4 address. They send no stored credentials and use no proxy.
import { createHash } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { Agent, request, type RequestOptions } from 'node:https';
import { decodeEntities } from '#lib/view.ts';

export type SourceTarget = { canonical: string; requestUrl: string };
type FailureStatus = 'unsupported' | 'not_found' | 'unavailable' | 'identity_mismatch' | 'unsupported_format';
export type SourceResponse = { status: number; headers: Record<string, string>; body: Uint8Array; url: string };
export type SourceTransport = (target: SourceTarget, deadlineAt?: number) => Promise<SourceResponse>;
type WireResponse = { status: number; headers: Record<string, string>; body: AsyncIterable<Uint8Array>; close?: () => void };
type SocketOptions = Omit<RequestOptions, 'headers'> & { headers: Record<string, string>; lookup: LookupFunction; autoSelectFamily: false };
export type Connector = (options: SocketOptions, signal: AbortSignal) => Promise<WireResponse>;
type TransportOptions = {
	resolve4?: (hostname: string) => Promise<string[]>;
	connect?: Connector;
	deadlineAt?: number;
};

const MAX_SOURCE_BYTES = 65_536;
const MAX_METADATA_BYTES = 262_144;
const SOURCE_DEADLINE_MS = 8_000;
const MAX_REDIRECTS = 2;
const CREDENTIAL = /oik_[a-f0-9]{48}/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const NOT_WEB_HOSTS = ['github.com', 'api.github.com', 'raw.githubusercontent.com', 'docs.google.com', 'drive.google.com', 'doi.org', 'arxiv.org', 'zenodo.org', 'x.com', 'twitter.com'];
const BLOCKED_HOSTS = ['vixra.org', 'aixiv.science', 'clawxiv.org', 'jaigp.org'];
export const isBlockedHost = (host: string) => BLOCKED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

const TOO_LARGE = 'The public response exceeds the source byte limit.';
const BAD_REDIRECT = 'A public endpoint redirected outside its permitted source family.';

export class SourceInputError extends Error {
	constructor() { super('This public source URL is not supported.'); }
}
export class RetrievalError extends Error {
	readonly status: FailureStatus;
	constructor(status: FailureStatus, message: string) {
		super(message);
		this.status = status;
	}
}
const inputError = () => new SourceInputError();
const fail = (status: FailureStatus, reason: string): never => { throw new RetrievalError(status, reason); };
/** A readable, deterministic key for a web URL: `<host>__<path-slug>` (matching sources.py Web). Pass `disambiguate` to append a short URL hash on slug collision. */
export function webKey(canonical: string, disambiguate = false): string {
	const url = new URL(canonical);
	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	const raw = url.pathname.replace(/\/+$/, '').replace(/\.(?:html?|pdf)$/i, '');
	const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	const normalized = `${url.protocol}//${url.host.toLowerCase()}${url.pathname || '/'}${url.search}`;
	const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 6);
	if (!slug) return `${host}__${hash}`;
	if (disambiguate || url.search || slug.length > 64) return `${host}__${slug.slice(0, 57).replace(/-+$/, '')}-${hash}`;
	return `${host}__${slug}`;
}
const rejectCredential = (text: string) => { if (CREDENTIAL.test(text)) fail('unsupported_format', 'The public response contains credential-shaped text and was not retained.'); };
const plainUrl = (url: URL) => url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash;

function parseUrl(value: string): URL | undefined {
	try { return new URL(value); } catch { return undefined; }
}

/** Reject ambiguous input before URL normalization can erase traversal or an explicit port. */
function inputURL(value: string): URL {
	if (typeof value !== 'string' || value.length > 2000 || CREDENTIAL.test(value) || value !== value.trim()
		|| /[\s\\\u0000-\u001f\u007f]/u.test(value) || !/^https:\/\//i.test(value)
		|| /\/(?:\.{1,2})(?:\/|[?#]|$)/.test(value) || /%(?:2f|5c|2e|00)/i.test(value)) throw inputError();
	const url = parseUrl(value);
	if (!url || !plainUrl(url) || /[\[\]:]/.test(url.hostname) || !/^[a-z0-9.-]+$/.test(url.hostname)
		|| url.pathname.includes('//')) throw inputError();
	return url;
}

/** A public HTML landing page for web intake; hosts with their own adapters or policies are refused. */
export function publicWebTarget(value: string): SourceTarget {
	const url = inputURL(value);
	const host = url.hostname;
	if ([...url.searchParams].length || !host.includes('.') || /^[0-9.]+$/.test(host) || host.endsWith('.')
		|| /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) || NOT_WEB_HOSTS.includes(host)
		|| isBlockedHost(host)) throw inputError();
	return { canonical: url.href, requestUrl: url.href };
}

/** Public IPv4 only: every special-purpose and private range is rejected, not just RFC 1918. */
function isPublicIPv4(ip: string): boolean {
	const words = ip.split('.');
	if (words.length !== 4 || words.some((word) => !/^(?:0|[1-9][0-9]{0,2})$/.test(word) || Number(word) > 255)) return false;
	const [a, b, c] = words.map(Number);
	return !(a === 0 || a === 10 || a === 127 || a >= 224
		|| (a === 100 && b >= 64 && b <= 127)
		|| (a === 169 && b === 254)
		|| (a === 172 && b >= 16 && b <= 31)
		|| (a === 192 && b === 168)
		|| (a === 192 && b === 0 && (c === 0 || c === 2))
		|| (a === 192 && b === 88 && c === 99)
		|| (a === 198 && (b === 18 || b === 19))
		|| (a === 198 && b === 51 && c === 100)
		|| (a === 203 && b === 0 && c === 113));
}

/** Rebuild the request from the canonical URL so a caller cannot supply its own request URL. */
function preparedRequest(input: SourceTarget): SourceTarget {
	const base = publicWebTarget(input.canonical);
	if (input.requestUrl !== base.requestUrl) throw inputError();
	return base;
}
function allowedHop(at: URL, initial: URL): boolean {
	if (!plainUrl(at) || at.origin !== initial.origin) return false;
	try { publicWebTarget(at.href); return true; } catch { return false; }
}
function header(headers: Record<string, string>, name: string): string {
	return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
}
function checkedHeaders(headers: Record<string, string>) {
	const encoding = header(headers, 'content-encoding').trim().toLowerCase();
	if (encoding && encoding !== 'identity') fail('unsupported_format', 'The public endpoint returned compressed content outside the bounded retrieval contract.');
	const length = header(headers, 'content-length').trim();
	if (length && (!/^[0-9]+$/.test(length) || Number(length) > MAX_METADATA_BYTES)) fail('unsupported_format', TOO_LARGE);
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const aborted = () => { cleanup(); reject(signal.reason); };
		const cleanup = () => signal.removeEventListener('abort', aborted);
		signal.addEventListener('abort', aborted, { once: true });
		pending.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
	});
}
const nativeConnect: Connector = async (options, signal) => new Promise((resolve, reject) => {
	const req = request({ ...options, signal }, (response) => {
		const headers: Record<string, string> = {};
		for (const name of ['content-type', 'content-length', 'content-encoding', 'location']) {
			const value = response.headers[name];
			if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(',') : value;
		}
		resolve({ status: response.statusCode ?? 0, headers, body: response, close: () => response.destroy() });
	});
	req.once('error', () => reject(new RetrievalError('unavailable', 'The public endpoint could not be reached with verified HTTPS.')));
	req.end();
});
function pinnedLookup(hostname: string, address: string): LookupFunction {
	return ((name: string, opts: { all?: boolean }, callback: (...args: unknown[]) => void) => {
		if (name !== hostname) callback(new Error('The pinned hostname changed.'));
		else if (opts?.all) callback(null, [{ address, family: 4 }]);
		else callback(null, address, 4);
	}) as LookupFunction;
}
async function readBody(response: WireResponse, maxBytes: number, signal: AbortSignal, checkDeadline: () => void): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let length = 0;
	const iterator = response.body[Symbol.asyncIterator]();
	while (true) {
		const chunk = await abortable(iterator.next(), signal);
		checkDeadline();
		if (chunk.done) break;
		if (!(chunk.value instanceof Uint8Array)) fail('unsupported_format', 'The public endpoint returned an unsupported response stream.');
		length += chunk.value.byteLength;
		if (length > maxBytes) fail('unsupported_format', TOO_LARGE);
		chunks.push(chunk.value);
	}
	const declared = header(response.headers, 'content-length').trim();
	if (declared && Number(declared) !== length) fail('unsupported_format', 'The public response was incomplete for its declared content length.');
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
	return body;
}

/** The returned URL is the fixed request, never a redirect Location. */
export async function boundedHttps(input: SourceTarget, options: TransportOptions = {}): Promise<SourceResponse> {
	const target = preparedRequest(input);
	const initial = new URL(target.requestUrl);
	const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + SOURCE_DEADLINE_MS);
	const deadlineError = new RetrievalError('unavailable', 'The absolute public source retrieval deadline expired.');
	const remaining = deadlineAt - Date.now();
	if (!Number.isFinite(remaining) || remaining <= 0) throw deadlineError;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(deadlineError), remaining);
	const signal = controller.signal;
	const connect = options.connect ?? nativeConnect;
	const resolver = options.resolve4 ?? resolve4;
	const checkDeadline = () => { if (signal.aborted || Date.now() >= deadlineAt) throw signal.reason ?? deadlineError; };
	let at = initial;
	try {
		for (let redirects = 0; ; redirects++) {
			checkDeadline();
			if (!allowedHop(at, initial)) fail('unsupported', BAD_REDIRECT);
			const ips = await abortable(resolver(at.hostname), signal);
			checkDeadline();
			if (!ips.length || ips.length > 32 || !ips.every(isPublicIPv4)) fail('unavailable', 'The public endpoint did not resolve exclusively to supported public IPv4 addresses.');
			const agent = new Agent({ keepAlive: false, maxSockets: 1, maxFreeSockets: 0, maxCachedSessions: 0, proxyEnv: {} as NodeJS.ProcessEnv });
			try {
				const response = await abortable(connect({
					protocol: 'https:', hostname: at.hostname, servername: at.hostname, method: 'GET', port: 443, maxHeaderSize: 16_384,
					path: `${at.pathname}${at.search}`, agent, family: 4, autoSelectFamily: false, rejectUnauthorized: true,
					lookup: pinnedLookup(at.hostname, ips[0]),
					headers: { Host: at.hostname, Accept: 'text/html', 'Accept-Encoding': 'identity', 'User-Agent': 'delphi-public-source/1', Connection: 'close' },
				}, signal), signal);
				try {
					checkDeadline();
					if ([301, 302, 303, 307, 308].includes(response.status)) {
						if (redirects >= MAX_REDIRECTS) fail('unavailable', 'The public endpoint exceeded the redirect limit.');
						const location = header(response.headers, 'location');
						if (!location || location.length > 4096 || /[\\\u0000- \u007f]/.test(location)) fail('unavailable', 'The public endpoint returned no bounded redirect location.');
						let next: URL;
						try { next = new URL(location, at); } catch { return fail('unavailable', 'The public endpoint returned an invalid redirect location.'); }
						if (!allowedHop(next, initial)) fail('unsupported', BAD_REDIRECT);
						at = next;
						continue;
					}
					if (response.status !== 200) return { status: response.status, headers: {}, body: new Uint8Array(), url: initial.href };
					checkedHeaders(response.headers);
					const body = await readBody(response, MAX_METADATA_BYTES, signal, checkDeadline);
					const headers = Object.fromEntries(['content-type', 'content-length', 'content-encoding']
						.map((name) => [name, header(response.headers, name)]).filter(([, value]) => value));
					return { status: response.status, body, url: initial.href, headers };
				} finally { response.close?.(); }
			} finally { agent.destroy(); }
		}
	} finally {
		clearTimeout(timer);
		controller.abort(deadlineError);
	}
}

function contentType(response: SourceResponse): string {
	const value = header(response.headers, 'content-type').toLowerCase();
	const charset = value.match(/charset\s*=\s*"?([^;"\s]+)/)?.[1];
	if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset)) fail('unsupported_format', 'The public response uses an unsupported text encoding.');
	return value.split(';')[0].trim();
}
function decode(value: Uint8Array): string {
	let text: string;
	try { text = new TextDecoder('utf-8', { fatal: true }).decode(value); } catch { return fail('unsupported_format', 'The public source is not valid UTF-8 text.'); }
	if (CONTROL.test(text)) fail('unsupported_format', 'The public source is not a supported plain-text file.');
	rejectCredential(text);
	return text;
}

type HtmlToken = { name: string; closing: boolean; raw: string; start: number; end: number };
function tagEnd(html: string, at: number): number {
	let quote = '';
	for (let index = at + 1; index < html.length; index++) {
		const point = html[index];
		if (quote) { if (point === quote) quote = ''; }
		else if (point === '"' || point === "'") quote = point;
		else if (point === '>') return index + 1;
	}
	return fail('unsupported_format', 'The public embed contains an incomplete inert HTML token.');
}
/** Single forward scan, so unclosed script/style elements cannot cause repeated searches. */
function* htmlTokens(html: string): Generator<HtmlToken> {
	const lower = html.toLowerCase();
	let at = 0;
	while (at < html.length) {
		const start = html.indexOf('<', at);
		if (start < 0) return;
		if (html.startsWith('<!--', start)) {
			const close = html.indexOf('-->', start + 4);
			if (close < 0) fail('unsupported_format', 'The public embed contains an incomplete comment.');
			at = close + 3;
			yield { name: '', closing: false, raw: '', start, end: at };
			continue;
		}
		const end = tagEnd(html, start), raw = html.slice(start, end);
		const name = raw.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/);
		at = end;
		if (!name) { yield { name: '', closing: false, raw, start, end }; continue; }
		const token: HtmlToken = { name: name[2].toLowerCase(), closing: Boolean(name[1]), raw, start, end };
		if (!token.closing && (token.name === 'script' || token.name === 'style')) {
			const closing = `</${token.name}`;
			let close = lower.indexOf(closing, end);
			while (close >= 0 && !/[\s/>]/.test(lower[close + closing.length] ?? '')) close = lower.indexOf(closing, close + closing.length);
			if (close < 0) fail('unsupported_format', 'The public embed contains an incomplete nontext element.');
			token.end = tagEnd(html, close);
			at = token.end;
		}
		yield token;
	}
}
function inertText(html: string): string {
	let at = 0, text = '';
	for (const token of htmlTokens(html)) { text += html.slice(at, token.start) + ' '; at = token.end; }
	text = decodeEntities(text + html.slice(at), ' ').replace(/\s+/g, ' ').trim();
	if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) fail('unsupported_format', 'The decoded public text exceeds the source text limit.');
	rejectCredential(text);
	return text;
}
/** The quoted value of an attribute that appears exactly once in the tag. */
function attr(tag: string, wanted: string): string | undefined {
	let at = 1, result: string | undefined, count = 0;
	while (at < tag.length && !/[\s>]/.test(tag[at])) at++;
	while (at < tag.length) {
		while (at < tag.length && /[\s/]/.test(tag[at])) at++;
		if (tag[at] === '>') break;
		const start = at;
		while (at < tag.length && !/[\s=/>]/.test(tag[at])) at++;
		const key = tag.slice(start, at).toLowerCase();
		while (at < tag.length && /\s/.test(tag[at])) at++;
		if (tag[at] !== '=') { if (at === start) at++; continue; }
		at++;
		while (at < tag.length && /\s/.test(tag[at])) at++;
		const quote = tag[at];
		if (quote !== '"' && quote !== "'") return;
		const end = tag.indexOf(quote, ++at);
		if (end < 0) return;
		if (key === wanted) { count++; result = tag.slice(at, end).replaceAll('&amp;', '&'); }
		at = end + 1;
	}
	return count === 1 ? result : undefined;
}
/** Truncate to `length` UTF-16 units without splitting a code point. */
function short(value: string, length: number) {
	let result = '';
	for (const point of value) {
		if (result.length + point.length > length) break;
		result += point;
	}
	return result;
}
function checkedResponse(response: SourceResponse, target: SourceTarget): string {
	if (response.url !== target.requestUrl) fail('identity_mismatch', 'The response does not match the fixed public source request.');
	if (!(response.body instanceof Uint8Array) || response.body.byteLength > MAX_METADATA_BYTES) fail('unsupported_format', TOO_LARGE);
	if (response.status === 404 || response.status === 410) fail('not_found', 'The public endpoint reported that this source was not found. This is not a judgment about the cited claim.');
	if (response.status !== 200) fail('unavailable', 'The public endpoint is unavailable or requires access not available to this credential-free check.');
	checkedHeaders(response.headers);
	return decode(response.body);
}

const defaultTransport: SourceTransport = (target, deadlineAt) => boundedHttps(target, { deadlineAt });

/** Page-reported title, authors, summary and date from a public HTML landing page. */
export async function readPublicWeb(url: string, transport: SourceTransport = defaultTransport) {
	const target = publicWebTarget(url);
	const response = await transport(target, Date.now() + SOURCE_DEADLINE_MS);
	const html = checkedResponse(response, target);
	if (contentType(response) !== 'text/html') fail('unsupported_format', 'Use a public HTML research landing page; PDFs and login-required material are unsupported.');
	const meta = new Map<string, string[]>();
	let title = '', titleAt: number | undefined;
	for (const token of htmlTokens(html)) {
		if (token.name === 'title' && !token.closing) titleAt = token.end;
		if (token.name === 'title' && token.closing && titleAt !== undefined) title = inertText(html.slice(titleAt, token.start));
		if (token.name !== 'meta' || token.closing) continue;
		const key = (attr(token.raw, 'name') ?? attr(token.raw, 'property'))?.toLowerCase();
		const value = attr(token.raw, 'content');
		if (key && value) {
			const values = meta.get(key) ?? [];
			if (values.length < 20) values.push(inertText(value));
			meta.set(key, values);
		}
	}
	const first = (...keys: string[]) => keys.map((k) => meta.get(k)?.[0]).find(Boolean);
	title = first('citation_title', 'og:title') ?? title;
	const summary = first('citation_abstract', 'description', 'og:description') ?? inertText(html);
	const authors = meta.get('citation_author') ?? meta.get('author') ?? [];
	const published = first('citation_publication_date', 'citation_online_date', 'citation_date', 'article:published_time')
		?.match(/\d{4}[-/]\d{2}[-/]\d{2}/)?.[0].replaceAll('/', '-');
	if (published && (!Number.isFinite(Date.parse(published)) || new Date(published).toISOString().slice(0, 10) !== published)) fail('unsupported_format', 'The page reported an invalid publication date.');
	if (!title || !summary) fail('unsupported_format', 'The page needs a source-reported title and research description.');
	return {
		source: 'web',
		key: webKey(target.canonical),
		url: target.canonical,
		title: short(title, 200),
		...(authors.length ? { authors: authors.map((a) => short(a, 200)).slice(0, 20) } : {}),
		summary: short(summary, 600),
		...(published ? { published } : {}),
	};
}
