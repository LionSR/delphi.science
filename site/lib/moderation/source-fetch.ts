// Bounded retrieval of public source text. Sockets use native HTTPS with a validated public IPv4
// pinned in the DNS lookup, and no ambient credentials or proxy agent.
import { createHash } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { Agent, request, type RequestOptions } from 'node:https';

export type SourceAdapter = 'github' | 'google_doc' | 'drive_folder' | 'x_post' | 'web';
export type SourceTarget = {
	canonical: string;
	adapter: SourceAdapter;
	requestUrl: string;
	identity: Record<string, string>;
	// Which Git object a GitHub request reads; other adapters make one fixed request.
	phase?: 'github_commit_object' | 'github_tree' | 'github_blob';
};
type SourceStatus = 'retrieved' | 'unsupported' | 'not_found' | 'unavailable' | 'identity_mismatch' | 'unsupported_format';
type FailureStatus = Exclude<SourceStatus, 'retrieved'>;
type FileMode = '100644' | '100755';
export type SourceRetrieval = {
	canonical: string; adapter: SourceAdapter; method: 'public-https-v1'; status: SourceStatus;
	reason: string; fix: string; observed_at: string; response_status?: number;
	title?: string; author?: string; excerpt?: string; digest?: string;
	requested_ref?: string; resolved_commit?: string; path?: string; blob_sha?: string; file_mode?: FileMode; root_tree_sha?: string;
};
export type SourceResponse = { status: number; headers: Record<string, string>; body: Uint8Array; url: string };
export type SourceTransport = (target: SourceTarget, deadlineAt?: number, remainingBytes?: number) => Promise<SourceResponse>;
type WireResponse = { status: number; headers: Record<string, string>; body: AsyncIterable<Uint8Array>; close?: () => void };
type SocketOptions = Omit<RequestOptions, 'headers'> & { headers: Record<string, string>; lookup: LookupFunction; autoSelectFamily: false };
export type Connector = (options: SocketOptions, signal: AbortSignal) => Promise<WireResponse>;
type TransportOptions = {
	resolve4?: (hostname: string) => Promise<string[]>;
	connect?: Connector;
	now?: () => number;
	deadlineAt?: number;
	deadlineMs?: number;
	maxBytes?: number;
};

const MAX_SOURCE_BYTES = 65_536;
export const MAX_METADATA_BYTES = 262_144;
const MAX_RETRIEVAL_BYTES = 1_048_576;
const SOURCE_DEADLINE_MS = 8_000;
const MAX_REDIRECTS = 2;
const SHA = /^[a-f0-9]{40}$/;
const CREDENTIAL = /oik_[a-f0-9]{48}/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const X_HOSTS = ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'];
const BINARY_FILE = /\.(?:pdf|docx?|odt|pptx?|xlsx?|zip|tar|gz|xz|bz2|7z|png|jpe?g|gif|webp|mp[34]|wav|ogg|woff2?|ttf|exe|dll|so)$/i;
const NOT_WEB_HOSTS = ['github.com', 'api.github.com', 'raw.githubusercontent.com', 'docs.google.com', 'drive.google.com', 'doi.org', 'arxiv.org', 'zenodo.org', 'x.com', 'twitter.com'];
const NOT_WEB_DOMAINS = ['vixra.org', 'aixiv.science', 'clawxiv.org', 'jaigp.org'];

const DEADLINE_EXPIRED = 'The absolute public source retrieval deadline expired.';
const TOO_LARGE = 'The public response exceeds the source byte limit.';
const CREDENTIAL_TEXT = 'The public response contains credential-shaped text and was not retained.';
const BAD_REDIRECT = 'A public endpoint redirected outside its permitted source family.';

export class SourceInputError extends Error {
	constructor(message = 'This public source URL is not supported.') { super(message); }
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
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
/** A web record's key: the first 12 hex digits of its canonical URL's SHA-1 (sources.py Web). */
export const webKey = (canonical: string) => createHash('sha1').update(canonical).digest('hex').slice(0, 12);
const responseCap = (adapter: SourceAdapter) => adapter === 'google_doc' ? MAX_SOURCE_BYTES : MAX_METADATA_BYTES;
const rejectCredential = (text: string) => { if (CREDENTIAL.test(text)) fail('unsupported_format', CREDENTIAL_TEXT); };
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
function queryOnly(url: URL, allowed: Record<string, readonly string[]>): void {
	for (const key of new Set(url.searchParams.keys())) {
		const values = url.searchParams.getAll(key);
		if (values.length !== 1 || !allowed[key]?.includes(values[0])) throw inputError();
	}
}
function segment(value: string): string {
	let decoded: string;
	try { decoded = decodeURIComponent(value); } catch { throw inputError(); }
	if (!decoded || decoded === '.' || decoded === '..' || /[%\\/\u0000-\u001f\u007f]/u.test(decoded)) throw inputError();
	return decoded;
}
function githubRequest(target: SourceTarget): string {
	const { owner, repo, ref, tree_sha, blob_sha } = target.identity;
	const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
	if (target.phase === 'github_tree') return `${base}/git/trees/${tree_sha}`;
	if (target.phase === 'github_blob') return `${base}/git/blobs/${blob_sha}`;
	return SHA.test(ref) ? `${base}/git/commits/${ref}` : '';
}

/** Only these input shapes can generate requests. Share parameters are dropped. */
export function canonicalSource(value: string): SourceTarget {
	const url = inputURL(value);
	const parts = url.pathname.split('/').slice(1).map(segment);
	if (url.hostname === 'github.com') {
		queryOnly(url, { plain: ['1'], raw: ['1'] });
		const [owner, repo, mode, ref, ...path] = parts;
		if (mode !== 'blob' || !owner || !repo || !ref || !path.length || path.length > 8
			|| !/^[a-zA-Z0-9_-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo)
			|| !/^[a-zA-Z0-9_.-]{1,100}$/.test(ref) || BINARY_FILE.test(path.at(-1)!)) throw inputError();
		const identity = { owner: owner.toLowerCase(), repo: repo.toLowerCase(), ref, path: path.join('/') };
		const canonical = `https://github.com/${identity.owner}/${identity.repo}/blob/${encodeURIComponent(ref)}/${path.map(encodeURIComponent).join('/')}`;
		const target: SourceTarget = { canonical, adapter: 'github', identity, phase: 'github_commit_object', requestUrl: '' };
		target.requestUrl = githubRequest(target);
		return target;
	}
	if (url.hostname === 'docs.google.com') {
		queryOnly(url, { usp: ['sharing', 'drive_link'] });
		const [kind, d, id, view] = parts;
		if (kind !== 'document' || d !== 'd' || !/^[a-zA-Z0-9_-]{10,100}$/.test(id ?? '')
			|| (parts.length !== 3 && !(parts.length === 4 && ['edit', 'view', 'preview'].includes(view)))) throw inputError();
		const canonical = `https://docs.google.com/document/d/${id}`;
		return { canonical, adapter: 'google_doc', identity: { id }, requestUrl: `${canonical}/export?format=txt` };
	}
	if (url.hostname === 'drive.google.com') {
		queryOnly(url, { usp: ['sharing', 'drive_link'] });
		if (parts.length !== 3 || parts[0] !== 'drive' || parts[1] !== 'folders' || !/^[a-zA-Z0-9_-]{10,100}$/.test(parts[2])) throw inputError();
		const canonical = `https://drive.google.com/drive/folders/${parts[2]}`;
		return { canonical, adapter: 'drive_folder', identity: { id: parts[2] }, requestUrl: canonical };
	}
	if (X_HOSTS.includes(url.hostname)) {
		queryOnly(url, { s: ['19', '20', '21'], t: [] });
		const [user, status, id] = parts;
		if (parts.length !== 3 || !/^[a-zA-Z0-9_]{1,15}$/.test(user) || status !== 'status' || !/^[1-9][0-9]{4,24}$/.test(id)) throw inputError();
		const handle = user.toLowerCase();
		const canonical = `https://x.com/${handle}/status/${id}`;
		return {
			canonical, adapter: 'x_post', identity: { handle, id },
			requestUrl: `https://publish.x.com/oembed?url=${encodeURIComponent(canonical)}&omit_script=true&dnt=true`,
		};
	}
	throw inputError();
}

/** A public HTML landing page for web intake; hosts with their own adapters or policies are refused. */
export function publicWebTarget(value: string): SourceTarget {
	const url = inputURL(value);
	queryOnly(url, {});
	const host = url.hostname;
	if (!host.includes('.') || /^[0-9.]+$/.test(host) || host.endsWith('.')
		|| /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) || NOT_WEB_HOSTS.includes(host)
		|| NOT_WEB_DOMAINS.some((h) => host === h || host.endsWith(`.${h}`))) throw inputError();
	return { canonical: url.href, adapter: 'web', requestUrl: url.href, identity: {} };
}

/** Public IPv4 only: every special-purpose and private range is rejected, not just RFC 1918. */
export function isPublicIPv4(ip: string): boolean {
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
	const base = input.adapter === 'web' ? publicWebTarget(input.canonical) : canonicalSource(input.canonical);
	if (base.adapter !== input.adapter) throw inputError();
	if (base.adapter === 'github') {
		if (!SHA.test(base.identity.ref)) throw new SourceInputError('Automatic GitHub retrieval requires a full 40-character commit SHA.');
		if (input.phase === 'github_tree' || input.phase === 'github_blob') {
			const key = input.phase === 'github_tree' ? 'tree_sha' : 'blob_sha';
			if (!SHA.test(input.identity[key] ?? '')) throw inputError();
			base.phase = input.phase;
			base.identity[key] = input.identity[key];
			base.requestUrl = githubRequest(base);
		} else if (input.phase && input.phase !== 'github_commit_object') throw inputError();
	}
	if (input.requestUrl !== base.requestUrl) throw inputError();
	return base;
}
function allowedHop(target: SourceTarget, at: URL, initial: URL): boolean {
	if (!plainUrl(at)) return false;
	switch (target.adapter) {
		case 'web':
			try { return at.origin === initial.origin && publicWebTarget(at.href).adapter === 'web'; } catch { return false; }
		case 'google_doc':
			if (at.hostname === 'docs.google.com') return at.pathname === initial.pathname && at.search === initial.search;
			return at.hostname.endsWith('.googleusercontent.com') && /^[a-z0-9.-]+$/.test(at.hostname);
		case 'x_post':
			return ['publish.x.com', 'publish.twitter.com'].includes(at.hostname) && at.pathname === '/oembed' && at.search === initial.search;
		default:
			return at.href === initial.href;
	}
}
function header(headers: Record<string, string>, name: string): string {
	return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
}
function checkedHeaders(headers: Record<string, string>, maxBytes = MAX_METADATA_BYTES) {
	const encoding = header(headers, 'content-encoding').trim().toLowerCase();
	if (encoding && encoding !== 'identity') fail('unsupported_format', 'The public endpoint returned compressed content outside the bounded retrieval contract.');
	const length = header(headers, 'content-length').trim();
	if (length && (!/^[0-9]+$/.test(length) || Number(length) > maxBytes)) fail('unsupported_format', TOO_LARGE);
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
const ACCEPT: Record<SourceAdapter, string> = {
	github: 'application/vnd.github+json', x_post: 'application/json', web: 'text/html', google_doc: 'text/plain', drive_folder: 'text/plain',
};

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

/** The returned URL is the fixed adapter request, never a provider's redirect Location. */
export async function boundedHttps(input: SourceTarget, options: TransportOptions = {}): Promise<SourceResponse> {
	const target = preparedRequest(input);
	const initial = new URL(target.requestUrl);
	const cap = responseCap(target.adapter);
	const maxBytes = Math.min(options.maxBytes ?? cap, cap);
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('unavailable', 'The whole-check source byte budget is exhausted.');
	if (target.adapter === 'drive_folder') fail('unsupported', 'A stable credential-free collection listing contract is not available.');
	const now = options.now ?? Date.now;
	const deadlineAt = Math.min(options.deadlineAt ?? Infinity, now() + Math.min(options.deadlineMs ?? SOURCE_DEADLINE_MS, SOURCE_DEADLINE_MS));
	const deadlineError = new RetrievalError('unavailable', DEADLINE_EXPIRED);
	const remaining = deadlineAt - now();
	if (!Number.isFinite(remaining) || remaining <= 0) throw deadlineError;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(deadlineError), remaining);
	const signal = controller.signal;
	const connect = options.connect ?? nativeConnect;
	const resolver = options.resolve4 ?? resolve4;
	const checkDeadline = () => { if (signal.aborted || now() >= deadlineAt) throw signal.reason ?? deadlineError; };
	let at = initial;
	try {
		for (let redirects = 0; ; redirects++) {
			checkDeadline();
			if (!allowedHop(target, at, initial)) fail('unsupported', BAD_REDIRECT);
			const ips = await abortable(resolver(at.hostname), signal);
			checkDeadline();
			if (!ips.length || ips.length > 32 || !ips.every(isPublicIPv4)) fail('unavailable', 'The public endpoint did not resolve exclusively to supported public IPv4 addresses.');
			const agent = new Agent({ keepAlive: false, maxSockets: 1, maxFreeSockets: 0, maxCachedSessions: 0, proxyEnv: {} as NodeJS.ProcessEnv });
			try {
				const response = await abortable(connect({
					protocol: 'https:', hostname: at.hostname, servername: at.hostname, method: 'GET', port: 443, maxHeaderSize: 16_384,
					path: `${at.pathname}${at.search}`, agent, family: 4, autoSelectFamily: false, rejectUnauthorized: true,
					lookup: pinnedLookup(at.hostname, ips[0]),
					headers: { Host: at.hostname, Accept: ACCEPT[target.adapter], 'Accept-Encoding': 'identity', 'User-Agent': 'open-research-index-public-source/1', Connection: 'close' },
				}, signal), signal);
				try {
					checkDeadline();
					if ([301, 302, 303, 307, 308].includes(response.status)) {
						if (target.adapter === 'github') fail('unsupported', 'GitHub object requests cannot redirect to a different object or repository.');
						if (redirects >= MAX_REDIRECTS) fail('unavailable', 'The public endpoint exceeded the redirect limit.');
						const location = header(response.headers, 'location');
						if (!location || location.length > 4096 || /[\\\u0000- \u007f]/.test(location)) fail('unavailable', 'The public endpoint returned no bounded redirect location.');
						let next: URL;
						try { next = new URL(location, at); } catch { return fail('unavailable', 'The public endpoint returned an invalid redirect location.'); }
						if (!allowedHop(target, next, initial)) fail('unsupported', BAD_REDIRECT);
						at = next;
						continue;
					}
					if (response.status !== 200) return { status: response.status, headers: {}, body: new Uint8Array(), url: initial.href };
					checkedHeaders(response.headers, maxBytes);
					const body = await readBody(response, maxBytes, signal, checkDeadline);
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
function object(text: string): Record<string, unknown> {
	let parsed: unknown;
	try { parsed = JSON.parse(text); } catch { return fail('unsupported_format', 'The public endpoint returned malformed structured data.'); }
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('unsupported_format', 'The public endpoint returned an unsupported structured response.');
	return parsed as Record<string, unknown>;
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
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function inertText(html: string): string {
	let at = 0, text = '';
	for (const token of htmlTokens(html)) { text += html.slice(at, token.start) + ' '; at = token.end; }
	text += html.slice(at);
	text = text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
		if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()];
		const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
		return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
	}).replace(/\s+/g, ' ').trim();
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
function embedBlock(html: string): string {
	let opening: HtmlToken | undefined, block: string | undefined;
	for (const token of htmlTokens(html)) {
		if (token.name !== 'blockquote') continue;
		if (!token.closing) {
			if (opening || block !== undefined) fail('unsupported_format', 'The X response contains multiple or nested post blocks.');
			opening = token;
		} else {
			if (!opening) return fail('unsupported_format', 'The X response contains an unmatched post block.');
			block = html.slice(opening.end, token.start);
			opening = undefined;
		}
	}
	if (opening || block === undefined) return fail('unsupported_format', 'The X response did not contain one complete inert post block.');
	return block;
}

function postIdentity(value: string): { handle: string; id: string } | undefined {
	const url = parseUrl(value);
	if (!url || !X_HOSTS.includes(url.hostname) || !plainUrl(url)) return;
	for (const [key, val] of url.searchParams) if (key !== 'ref_src' || val !== 'twsrc^tfw') return;
	const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/([1-9][0-9]{4,24})\/?$/);
	return match ? { handle: match[1].toLowerCase(), id: match[2] } : undefined;
}
function publicAuthor(value: unknown, handle: string): boolean {
	const url = typeof value === 'string' ? parseUrl(value) : undefined;
	return !!url && plainUrl(url) && !url.search && X_HOSTS.includes(url.hostname)
		&& url.pathname.replace(/\/$/, '').toLowerCase() === `/${handle}`;
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
	if (!(response.body instanceof Uint8Array) || response.body.byteLength > responseCap(target.adapter)) fail('unsupported_format', TOO_LARGE);
	if (response.status === 404 || response.status === 410) fail('not_found', 'The public endpoint reported that this source was not found. This is not a judgment about the cited claim.');
	if (response.status !== 200) fail('unavailable', 'The public endpoint is unavailable or requires access not available to this credential-free check.');
	checkedHeaders(response.headers);
	return decode(response.body);
}

type Fetched = { response: SourceResponse; text: string };
type Retrieved = Omit<SourceRetrieval, 'canonical' | 'adapter' | 'method' | 'observed_at' | 'status' | 'response_status'>;

/** Walk commit → tree → blob through the Git object API, checking every object's identity. */
async function retrieveGithub(base: SourceTarget, get: (target: SourceTarget) => Promise<Fetched>): Promise<Retrieved> {
	const git = async (phase: SourceTarget['phase'], binding: Record<string, string> = {}) => {
		const target: SourceTarget = { ...base, phase, identity: { ...base.identity, ...binding }, requestUrl: '' };
		target.requestUrl = githubRequest(target);
		const fetched = await get(target);
		if (!['application/json', 'application/vnd.github+json'].includes(contentType(fetched.response))) fail('unsupported_format', 'GitHub did not return the bounded Git object JSON format.');
		return { ...fetched, data: object(fetched.text) };
	};
	const { ref: resolved_commit, path } = base.identity;
	const commit = (await git('github_commit_object')).data;
	const tree = commit.tree as Record<string, unknown> | undefined;
	if (commit.sha !== resolved_commit || !tree || typeof tree !== 'object' || Array.isArray(tree) || !SHA.test(String(tree.sha ?? ''))) {
		fail('identity_mismatch', 'The Git commit object did not bind the resolved commit to its root tree.');
	}
	const root_tree_sha = tree!.sha as string;
	const segments = path.split('/');
	let tree_sha = root_tree_sha, blob_sha = '', file_mode: FileMode | undefined;
	for (let index = 0; index < segments.length; index++) {
		const current = (await git('github_tree', { tree_sha })).data;
		if (current.sha !== tree_sha || current.truncated !== false || !Array.isArray(current.tree)) fail('identity_mismatch', 'The Git tree response was incomplete or did not match the requested tree.');
		const matches = (current.tree as unknown[]).filter((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).path === segments[index]);
		if (matches.length !== 1) fail('identity_mismatch', 'The exact requested path was not present unambiguously in the Git tree.');
		const entry = matches[0] as Record<string, unknown>;
		if (typeof entry.sha !== 'string' || !SHA.test(entry.sha)) fail('identity_mismatch', 'The Git tree entry did not identify a bounded Git object.');
		if (index < segments.length - 1) {
			if (entry.type !== 'tree' || entry.mode !== '040000') fail('unsupported_format', 'The requested Git path is not an ordinary tree path; no link or submodule was followed.');
			tree_sha = entry.sha as string;
		} else {
			if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) fail('unsupported_format', 'The requested Git object is not a regular file; no symlink or submodule was followed.');
			if (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || Number(entry.size) > MAX_SOURCE_BYTES || Number(entry.size) < 0)) fail('unsupported_format', 'The Git tree reports a file outside the bounded text limit.');
			blob_sha = entry.sha as string;
			file_mode = entry.mode as FileMode;
		}
	}
	const fetched = await git('github_blob', { blob_sha });
	const data = fetched.data;
	if (data.sha !== blob_sha) fail('identity_mismatch', 'The Git blob response did not match the bound tree entry.');
	if (data.encoding !== 'base64' || typeof data.content !== 'string' || !Number.isSafeInteger(data.size)
		|| Number(data.size) < 1 || Number(data.size) > MAX_SOURCE_BYTES) fail('unsupported_format', 'The Git blob is outside the bounded Base64 text-file contract.');
	const clean = (data.content as string).replace(/[\r\n]/g, '');
	if (clean.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)) fail('unsupported_format', 'The Git blob did not contain valid bounded Base64 text.');
	const raw = Buffer.from(clean, 'base64');
	if (raw.byteLength !== data.size || raw.toString('base64') !== clean) fail('identity_mismatch', 'The Git blob size does not match its content.');
	if (createHash('sha1').update(`blob ${raw.byteLength}\0`).update(raw).digest('hex') !== blob_sha) fail('identity_mismatch', 'The returned Git content does not match its blob identity.');
	const excerpt = decode(raw).trim();
	if (excerpt.startsWith('%PDF-')) fail('unsupported_format', 'PDF interpretation is outside the public text-source contract.');
	if (!excerpt) fail('unsupported_format', 'The public file has no usable text excerpt.');
	return {
		requested_ref: resolved_commit, resolved_commit, path, blob_sha, file_mode, root_tree_sha,
		title: short(path, 200), excerpt: short(excerpt, 2000), digest: sha256(fetched.response.body),
		reason: 'Retrieved a public regular text file at the resolved GitHub commit. Its scientific claims remain unassessed.',
		fix: 'Review the retrieved excerpt and source version, then explicitly resubmit your discussion for the normal quality check.',
	};
}

function googleDoc({ response, text }: Fetched): Retrieved {
	if (contentType(response) !== 'text/plain') fail('unavailable', 'The fixed Google document export did not expose public UTF-8 text; an access wall or unsupported export may be present.');
	const excerpt = text.trim();
	if (!excerpt) fail('unsupported_format', 'The public Google text export is empty.');
	return {
		excerpt: short(excerpt, 2000), digest: sha256(response.body),
		reason: 'Retrieved the fixed public Google document text export. Its scientific claims remain unassessed.',
		fix: 'Check whether this excerpt contains the specific material your statement relies on, then explicitly resubmit for moderation.',
	};
}

function xPost(base: SourceTarget, { response, text }: Fetched): Retrieved {
	if (contentType(response) !== 'application/json') fail('unsupported_format', 'The official X oEmbed endpoint did not return its structured format.');
	const data = object(text);
	const { handle, id } = base.identity;
	if (data.type !== 'rich' || typeof data.html !== 'string' || typeof data.author_name !== 'string' || !data.author_name.trim()
		|| !publicAuthor(data.author_url, handle)) fail('identity_mismatch', 'The X response did not establish the requested post and reported author identity.');
	const block = embedBlock(data.html as string);
	const samePost = (value: string) => {
		const post = postIdentity(value);
		return post?.handle === handle && post.id === id;
	};
	const linksPost = [...htmlTokens(block)].some((token) => {
		const href = token.name === 'a' && !token.closing ? attr(token.raw, 'href') : undefined;
		return !!href && samePost(href);
	});
	if (!linksPost || (data.url !== undefined && (typeof data.url !== 'string' || !samePost(data.url)))) fail('identity_mismatch', 'The X response did not contain the exact requested status URL.');
	const excerpt = inertText(block);
	if (!excerpt) fail('unsupported_format', 'The X response contains no usable inert post text.');
	const author = (data.author_name as string).replace(/\s+/g, ' ').trim();
	if (!author || Buffer.byteLength(author) > MAX_SOURCE_BYTES || CONTROL.test(author)) fail('unsupported_format', 'The reported author metadata is outside the bounded text contract.');
	rejectCredential(author);
	return {
		author: short(author, 100), excerpt: short(excerpt, 2000), digest: sha256(response.body),
		reason: 'Retrieved an official oEmbed response bound to the requested post and its reported author. Authorship and scientific claims are not independently verified.',
		fix: 'Review the attributed post excerpt, then explicitly resubmit your discussion for the ordinary quality gate.',
	};
}

const defaultTransport: SourceTransport = (target, deadlineAt, remainingBytes) => boundedHttps(target, { deadlineAt, maxBytes: remainingBytes });

/** Retrieve one source through its fixed adapter. Retrieval says nothing about whether its claims are correct. */
export async function retrieveSource(input: SourceTarget, transport: SourceTransport = defaultTransport, callerDeadlineAt?: number): Promise<SourceRetrieval> {
	const observed_at = new Date().toISOString();
	const base = canonicalSource(input.canonical);
	const common = { canonical: base.canonical, adapter: base.adapter, method: 'public-https-v1' as const, observed_at };
	if (base.adapter === 'drive_folder') return {
		...common, status: 'unsupported',
		reason: 'A stable credential-free public collection listing is not supported; no child documents were checked.',
		fix: 'Provide an individual public document or GitHub text file for the material needed to assess your statement.',
	};
	if (base.adapter === 'github' && !SHA.test(base.identity.ref)) return {
		...common, status: 'unsupported',
		reason: 'Automatic GitHub retrieval requires a full 40-character commit SHA; a branch URL is not immutable source evidence.',
		fix: 'Use GitHub Copy permalink to obtain a /blob/<full commit SHA>/ URL, then explicitly check that URL. A historical operator observation is not a fresh immutable retrieval.',
	};
	const deadlineAt = Math.min(Date.now() + SOURCE_DEADLINE_MS, callerDeadlineAt ?? Infinity);
	if (!Number.isFinite(deadlineAt) || deadlineAt <= Date.now()) return {
		...common, status: 'unavailable', reason: 'The source retrieval deadline has expired.', fix: 'Keep your draft and explicitly check the public source again later.',
	};
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new RetrievalError('unavailable', DEADLINE_EXPIRED)), Math.max(0, deadlineAt - Date.now()));
	const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= deadlineAt) fail('unavailable', DEADLINE_EXPIRED); };
	let consumed = 0;
	let response_status: number | undefined;
	const get = async (target: SourceTarget): Promise<Fetched> => {
		checkDeadline();
		const remainingBytes = MAX_RETRIEVAL_BYTES - consumed;
		if (remainingBytes <= 0) fail('unavailable', 'The whole-check source byte budget is exhausted.');
		const response = await abortable(transport(target, deadlineAt, remainingBytes), controller.signal);
		checkDeadline();
		consumed += response.body.byteLength;
		if (consumed > MAX_RETRIEVAL_BYTES) fail('unsupported_format', 'The whole-check source byte limit was exceeded.');
		response_status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : undefined;
		return { response, text: checkedResponse(response, target) };
	};
	try {
		const retrieved = base.adapter === 'github' ? await retrieveGithub(base, get)
			: base.adapter === 'google_doc' ? googleDoc(await get(base))
				: xPost(base, await get(base));
		return { ...common, status: 'retrieved', response_status, ...retrieved };
	} catch (error) {
		const known = error instanceof RetrievalError || error instanceof SourceInputError;
		return {
			...common,
			status: error instanceof RetrievalError ? error.status : error instanceof SourceInputError ? 'unsupported' : 'unavailable',
			response_status,
			reason: known ? error.message : 'The fixed public endpoint could not complete a bounded source check.',
			fix: 'Keep your draft. Use an individual publicly accessible supported source or retry this explicit check later; unavailable material is not evidence that a claim is false.',
		};
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

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
