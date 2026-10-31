// Public evidence is bounded source data, never a verdict or a claim of scientific correctness.
// All sockets use native HTTPS with a validated IPv4 pinned in lookup; no ambient auth or proxy agent.
import { createHash } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { Agent, request, type RequestOptions } from 'node:https';

export type SourceAdapter = 'github' | 'google_doc' | 'drive_folder' | 'x_post';
export type SourceTarget = {
  canonical: string; adapter: SourceAdapter; requestUrl: string;
  identity: Record<string, string>; phase?: 'github_commit_object' | 'github_tree' | 'github_blob' | 'single';
};
export type SourceStatus = 'retrieved' | 'unsupported' | 'not_found' | 'unavailable' | 'identity_mismatch' | 'unsupported_format';
export type SourceRetrieval = {
  canonical: string; adapter: SourceAdapter; method: 'public-https-v1'; status: SourceStatus;
  reason: string; fix: string; observed_at: string; response_status?: number;
  title?: string; author?: string; excerpt?: string; digest?: string;
  requested_ref?: string; resolved_commit?: string; path?: string; blob_sha?: string; file_mode?: '100644' | '100755'; root_tree_sha?: string;
};
export type SourceResponse = { status: number; headers: Record<string, string>; body: Uint8Array; url: string };
export type SourceTransport = (target: SourceTarget, deadlineAt?: number, remainingBytes?: number) => Promise<SourceResponse>;
export type WireResponse = { status: number; headers: Record<string, string>; body: AsyncIterable<Uint8Array>; close?: () => void };
export type SocketOptions = Omit<RequestOptions, 'headers'> & { headers: Record<string, string>; lookup: LookupFunction; autoSelectFamily: false };
export type Connector = (options: SocketOptions, signal: AbortSignal) => Promise<WireResponse>;
export type TransportOptions = {
  resolve4?: (hostname: string) => Promise<string[]>; connect?: Connector; now?: () => number;
  deadlineAt?: number; deadlineMs?: number; maxBytes?: number;
};
export const MAX_SOURCE_BYTES = 65_536;
export const MAX_METADATA_BYTES = 262_144;
export const MAX_RETRIEVAL_BYTES = 1_048_576;
export const SOURCE_DEADLINE_MS = 8_000;
const MAX_REDIRECTS = 2;
const SHA = /^[a-f0-9]{40}$/;
const CREDENTIAL = /oik_[a-f0-9]{48}/i;

export class SourceInputError extends Error {
  readonly fix: string;
  constructor(message = 'This public source URL is not supported.', fix = 'Use a public GitHub text-file URL, a public Google document URL, or an X post URL without access tokens.') {
    super(message); this.fix = fix;
  }
}
class RetrievalError extends Error {
  readonly status: Exclude<SourceStatus, 'retrieved'>;
  constructor(status: Exclude<SourceStatus, 'retrieved'>, message: string) { super(message); this.status = status; }
}
const inputError = () => new SourceInputError();
const fail = (status: Exclude<SourceStatus, 'retrieved'>, reason: string): never => { throw new RetrievalError(status, reason); };
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const enc = (s: string) => encodeURIComponent(s);

/** Reject ambiguous input before URL normalization can erase traversal or an explicit port. */
function inputURL(value: string): URL {
  if (typeof value !== 'string' || value.length > 2000 || CREDENTIAL.test(value) || value !== value.trim() || /[\s\\\u0000-\u001f\u007f]/u.test(value)
    || !/^https:\/\//i.test(value) || /\/(?:\.{1,2})(?:\/|[?#]|$)/.test(value) || /%(?:2f|5c|2e|00)/i.test(value)) throw inputError();
  let url: URL; try { url = new URL(value); } catch { throw inputError(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || /[\[\]:]/.test(url.hostname)
    || !/^[a-z0-9.-]+$/.test(url.hostname) || url.pathname.includes('//')) throw inputError();
  return url;
}
function queryOnly(url: URL, allowed: Record<string, readonly string[]>): void {
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1 || !allowed[key]?.includes(values[0])) throw inputError();
  }
}
function segment(value: string): string {
  let decoded: string; try { decoded = decodeURIComponent(value); } catch { throw inputError(); }
  if (!decoded || decoded === '.' || decoded === '..' || /[%\\/\u0000-\u001f\u007f]/u.test(decoded)) throw inputError();
  return decoded;
}
function githubRequest(target: SourceTarget): string {
  const { owner, repo, ref, tree_sha, blob_sha } = target.identity;
  const base = `https://api.github.com/repos/${enc(owner)}/${enc(repo)}`;
  if (target.phase === 'github_commit_object') return SHA.test(ref) ? `${base}/git/commits/${ref}` : '';
  if (target.phase === 'github_tree') return `${base}/git/trees/${tree_sha}`;
  if (target.phase === 'github_blob') return `${base}/git/blobs/${blob_sha}`;
  return SHA.test(ref) ? `${base}/git/commits/${ref}` : '';
}

/** Only these input shapes can generate requests. Share parameters are dropped, never forwarded. */
export function canonicalSource(value: string): SourceTarget {
  const url = inputURL(value), parts = url.pathname.split('/').slice(1).map(segment);
  if (url.hostname === 'github.com') {
    queryOnly(url, { plain: ['1'], raw: ['1'] });
    const [owner, repo, mode, requested_ref, ...path] = parts;
    if (mode !== 'blob' || !owner || !repo || !requested_ref || !path.length || path.length > 8 || !/^[a-zA-Z0-9_-]{1,100}$/.test(owner)
      || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(requested_ref)) throw inputError();
    if (requested_ref === '.' || requested_ref === '..' || /\.(?:pdf|docx?|odt|pptx?|xlsx?|zip|tar|gz|xz|bz2|7z|png|jpe?g|gif|webp|mp[34]|wav|ogg|woff2?|ttf|exe|dll|so)$/i.test(path.at(-1)!)) throw inputError();
    const identity = { owner: owner.toLowerCase(), repo: repo.toLowerCase(), ref: requested_ref, path: path.join('/') };
    const canonical = `https://github.com/${identity.owner}/${identity.repo}/blob/${enc(requested_ref)}/${path.map(enc).join('/')}`;
    const target: SourceTarget = { canonical, adapter: 'github', identity, phase: 'github_commit_object', requestUrl: '' };
    if (SHA.test(requested_ref)) target.identity.resolved_commit = requested_ref;
    target.requestUrl = githubRequest(target); return target;
  }
  if (url.hostname === 'docs.google.com') {
    queryOnly(url, { usp: ['sharing', 'drive_link'] });
    if (parts[0] !== 'document' || parts[1] !== 'd' || !/^[a-zA-Z0-9_-]{10,100}$/.test(parts[2] ?? '')
      || (parts.length !== 3 && !(parts.length === 4 && ['edit', 'view', 'preview'].includes(parts[3])))) throw inputError();
    const id = parts[2], canonical = `https://docs.google.com/document/d/${id}`;
    return { canonical, adapter: 'google_doc', identity: { id }, phase: 'single', requestUrl: `${canonical}/export?format=txt` };
  }
  if (url.hostname === 'drive.google.com') {
    queryOnly(url, { usp: ['sharing', 'drive_link'] });
    if (parts.length !== 3 || parts[0] !== 'drive' || parts[1] !== 'folders' || !/^[a-zA-Z0-9_-]{10,100}$/.test(parts[2])) throw inputError();
    const canonical = `https://drive.google.com/drive/folders/${parts[2]}`;
    return { canonical, adapter: 'drive_folder', identity: { id: parts[2] }, phase: 'single', requestUrl: canonical };
  }
  if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) {
    queryOnly(url, { s: ['19', '20', '21'], t: [] });
    if (parts.length !== 3 || !/^[a-zA-Z0-9_]{1,15}$/.test(parts[0]) || parts[1] !== 'status' || !/^[1-9][0-9]{4,24}$/.test(parts[2])) throw inputError();
    const canonical = `https://x.com/${parts[0].toLowerCase()}/status/${parts[2]}`;
    return { canonical, adapter: 'x_post', identity: { handle: parts[0].toLowerCase(), id: parts[2] }, phase: 'single', requestUrl: `https://publish.x.com/oembed?url=${enc(canonical)}&omit_script=true&dnt=true` };
  }
  throw inputError();
}

/** Conservative public IPv4 allowlist: reject every special/private range, not just RFC1918. */
export function isPublicIPv4(ip: string): boolean {
  const words = ip.split('.');
  if (words.length !== 4 || words.some((word) => !/^(?:0|[1-9][0-9]{0,2})$/.test(word) || Number(word) > 255)) return false;
  const [a, b, c] = words.map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
}
function preparedRequest(input: SourceTarget): SourceTarget {
  const base = canonicalSource(input.canonical);
  if (base.adapter !== input.adapter) throw inputError();
  if (base.adapter === 'github') {
    if (!SHA.test(base.identity.ref)) throw new SourceInputError('Automatic GitHub retrieval requires a full 40-character commit SHA.', 'Use GitHub Copy permalink to obtain a /blob/<full commit SHA>/ URL, then explicitly check it again. Branch URLs can be reviewed separately as historical operator observations.');
    if (input.phase === 'github_tree' || input.phase === 'github_blob') {
      const key = input.phase === 'github_tree' ? 'tree_sha' : 'blob_sha';
      if (!SHA.test(input.identity[key] ?? '')) throw inputError();
      base.phase = input.phase; base.identity[key] = input.identity[key]; base.requestUrl = githubRequest(base);
    } else if (input.phase && input.phase !== 'github_commit_object') throw inputError();
  }
  if (input.requestUrl !== base.requestUrl) throw inputError();
  return base;
}
function allowedHop(target: SourceTarget, at: URL, initial: URL): boolean {
  if (at.protocol !== 'https:' || at.username || at.password || at.port || at.hash) return false;
  if (target.adapter === 'google_doc') {
    if (at.hostname === 'docs.google.com') return at.pathname === initial.pathname && at.search === initial.search;
    return at.hostname.endsWith('.googleusercontent.com') && /^[a-z0-9.-]+$/.test(at.hostname);
  }
  if (target.adapter === 'x_post') return ['publish.x.com', 'publish.twitter.com'].includes(at.hostname) && at.pathname === '/oembed' && at.search === initial.search;
  return at.href === initial.href;
}
function header(headers: Record<string, string>, name: string): string {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
}
function checkedHeaders(headers: Record<string, string>, maxBytes = MAX_METADATA_BYTES) {
  const encoding = header(headers, 'content-encoding').trim().toLowerCase();
  if (encoding && encoding !== 'identity') fail('unsupported_format', 'The public endpoint returned compressed content outside the bounded retrieval contract.');
  const length = header(headers, 'content-length').trim();
  if (length && (!/^[0-9]+$/.test(length) || Number(length) > maxBytes)) fail('unsupported_format', 'The public response exceeds the source byte limit.');
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

/** The returned URL is the fixed adapter request, never an opaque provider Location. */
export async function boundedHttps(input: SourceTarget, options: TransportOptions = {}): Promise<SourceResponse> {
  const target = preparedRequest(input), initial = new URL(target.requestUrl);
  const responseCap = target.adapter === 'google_doc' ? MAX_SOURCE_BYTES : MAX_METADATA_BYTES;
  const maxBytes = Math.min(options.maxBytes ?? responseCap, responseCap);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('unavailable', 'The whole-check source byte budget is exhausted.');
  if (target.adapter === 'drive_folder') fail('unsupported', 'A stable credential-free collection listing contract is not available.');
  const now = options.now ?? Date.now;
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, now() + Math.min(options.deadlineMs ?? SOURCE_DEADLINE_MS, SOURCE_DEADLINE_MS));
  const controller = new AbortController();
  const deadlineError = new RetrievalError('unavailable', 'The absolute public source retrieval deadline expired.');
  const remaining = deadlineAt - now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw deadlineError;
  const timer = setTimeout(() => controller.abort(deadlineError), remaining);
  const signal = controller.signal;
  const connector = options.connect ?? nativeConnect, resolver = options.resolve4 ?? resolve4;
  const checkDeadline = () => { if (signal.aborted || now() >= deadlineAt) throw signal.reason ?? deadlineError; };
  let at = initial;
  try {
    for (let redirects = 0; ; redirects++) {
      checkDeadline();
      if (!allowedHop(target, at, initial)) fail('unsupported', 'A public endpoint redirected outside its permitted source family.');
      const ips = await abortable(resolver(at.hostname), signal);
      checkDeadline();
      if (!ips.length || ips.length > 32 || !ips.every(isPublicIPv4)) fail('unavailable', 'The public endpoint did not resolve exclusively to supported public IPv4 addresses.');
      const pinned = ips[0], pinnedHostname = at.hostname;
      const lookup = ((hostname: string, opts: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (hostname !== pinnedHostname) { callback(new Error('The pinned hostname changed.')); return; }
        if (opts?.all) callback(null, [{ address: pinned, family: 4 }]); else callback(null, pinned, 4);
      }) as LookupFunction;
      const accept = target.adapter === 'github' ? 'application/vnd.github+json'
        : target.adapter === 'x_post' ? 'application/json' : 'text/plain';
      const agent = new Agent({ keepAlive: false, maxSockets: 1, maxFreeSockets: 0, maxCachedSessions: 0, proxyEnv: {} as NodeJS.ProcessEnv });
      try {
        const response = await abortable(connector({ protocol: 'https:', hostname: at.hostname, servername: at.hostname,
          method: 'GET', port: 443, maxHeaderSize: 16_384, path: `${at.pathname}${at.search}`, agent, family: 4, autoSelectFamily: false, rejectUnauthorized: true, lookup,
          headers: { Host: at.hostname, Accept: accept, 'Accept-Encoding': 'identity', 'User-Agent': 'open-research-index-public-source/1', Connection: 'close' },
        }, signal), signal);
        try {
          checkDeadline();
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (target.adapter === 'github') fail('unsupported', 'GitHub object requests cannot redirect to a different object or repository.');
            if (redirects >= MAX_REDIRECTS) fail('unavailable', 'The public endpoint exceeded the redirect limit.');
            const location = header(response.headers, 'location');
            if (!location || location.length > 4096 || /[\\\u0000-\u0020\u007f]/.test(location)) fail('unavailable', 'The public endpoint returned no bounded redirect location.');
            let next: URL; try { next = new URL(location, at); } catch { fail('unavailable', 'The public endpoint returned an invalid redirect location.'); }
            if (!allowedHop(target, next!, initial)) fail('unsupported', 'A public endpoint redirected outside its permitted source family.');
            at = next!; continue;
          }
          if (response.status !== 200) return { status: response.status, headers: {}, body: new Uint8Array(), url: initial.href };
          checkedHeaders(response.headers, maxBytes);
          const chunks: Uint8Array[] = []; let length = 0;
          const iterator = response.body[Symbol.asyncIterator]();
          while (true) {
            const chunk = await abortable(iterator.next(), signal);
            checkDeadline();
            if (chunk.done) break;
            if (!(chunk.value instanceof Uint8Array)) fail('unsupported_format', 'The public endpoint returned an unsupported response stream.');
            length += chunk.value.byteLength;
            if (length > maxBytes) fail('unsupported_format', 'The public response exceeds the source byte limit.');
            chunks.push(chunk.value);
          }
          const declared = header(response.headers, 'content-length').trim();
          if (declared && Number(declared) !== length) fail('unsupported_format', 'The public response was incomplete for its declared content length.');
          const body = new Uint8Array(length); let offset = 0;
          for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
          return { status: response.status, body, url: initial.href,
            headers: Object.fromEntries(['content-type', 'content-length', 'content-encoding'].map((name) => [name, header(response.headers, name)]).filter(([, value]) => value)) };
        } finally { response.close?.(); }
      } finally { agent.destroy(); }
    }
  } finally { clearTimeout(timer); controller.abort(deadlineError); }
}
function contentType(response: SourceResponse): string {
  const value = header(response.headers, 'content-type').toLowerCase();
  const charset = value.match(/charset\s*=\s*"?([^;"\s]+)/)?.[1];
  if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset)) fail('unsupported_format', 'The public response uses an unsupported text encoding.');
  return value.split(';')[0].trim();
}
function decode(value: Uint8Array): string {
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(value); } catch { fail('unsupported_format', 'The public source is not valid UTF-8 text.'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text!)) fail('unsupported_format', 'The public source is not a supported plain-text file.');
  if (CREDENTIAL.test(text!)) fail('unsupported_format', 'The public response contains credential-shaped text and was not retained.');
  return text!;
}
function object(text: string): Record<string, unknown> {
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { fail('unsupported_format', 'The public endpoint returned malformed structured data.'); }
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
/** Monotone token scanning: no repeated unclosed script/style regular-expression searches. */
function* htmlTokens(html: string): Generator<HtmlToken> {
  const lower = html.toLowerCase(); let at = 0;
  while (at < html.length) {
    const start = html.indexOf('<', at); if (start < 0) return;
    if (html.startsWith('<!--', start)) {
      const close = html.indexOf('-->', start + 4);
      if (close < 0) fail('unsupported_format', 'The public embed contains an incomplete comment.');
      at = close + 3; yield { name: '', closing: false, raw: '', start, end: at }; continue;
    }
    const end = tagEnd(html, start), raw = html.slice(start, end);
    const name = raw.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/);
    at = end;
    if (!name) { yield { name: '', closing: false, raw, start, end }; continue; }
    const token: HtmlToken = { name: name[2].toLowerCase(), closing: Boolean(name[1]), raw, start, end };
    if (!token.closing && ['script', 'style'].includes(token.name)) {
      const closing = `</${token.name}`;
      let close = lower.indexOf(closing, end);
      while (close >= 0 && !/[\s/>]/.test(lower[close + closing.length] ?? '')) close = lower.indexOf(closing, close + closing.length);
      if (close < 0) fail('unsupported_format', 'The public embed contains an incomplete nontext element.');
      token.end = tagEnd(html, close); at = token.end;
    }
    yield token;
  }
}
function inertText(html: string): string {
  let at = 0, text = '';
  for (const token of htmlTokens(html)) { text += html.slice(at, token.start) + ' '; at = token.end; }
  text += html.slice(at);
  text = text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' ';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[entity.toLowerCase()];
  }).replace(/\s+/g, ' ').trim();
  if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) fail('unsupported_format', 'The decoded public text exceeds the source text limit.');
  if (CREDENTIAL.test(text)) fail('unsupported_format', 'The public response contains credential-shaped text and was not retained.');
  return text;
}
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
    at++; while (at < tag.length && /\s/.test(tag[at])) at++;
    const quote = tag[at]; if (quote !== '"' && quote !== "'") return;
    const end = tag.indexOf(quote, ++at); if (end < 0) return;
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
      if (!opening) fail('unsupported_format', 'The X response contains an unmatched post block.');
      block = html.slice(opening!.end, token.start); opening = undefined;
    }
  }
  if (opening || block === undefined) fail('unsupported_format', 'The X response did not contain one complete inert post block.');
  return block!;
}

function postIdentity(value: string): { handle: string; id: string } | undefined {
  let url: URL; try { url = new URL(value); } catch { return; }
  if (!['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname) || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return;
  for (const [key, val] of url.searchParams) if (key !== 'ref_src' || val !== 'twsrc^tfw') return;
  const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/([1-9][0-9]{4,24})\/?$/);
  return match ? { handle: match[1].toLowerCase(), id: match[2] } : undefined;
}
function publicAuthor(value: unknown, handle: string): boolean {
  if (typeof value !== 'string') return false;
  let url: URL; try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
    && ['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(url.hostname) && url.pathname.replace(/\/$/, '').toLowerCase() === `/${handle}`;
}
function short(value: string, length: number) {
  let result = '';
  for (const point of value) { if (result.length + point.length > length) break; result += point; }
  return result;
}
function checkedResponse(response: SourceResponse, target: SourceTarget): string {
  if (response.url !== target.requestUrl) fail('identity_mismatch', 'The response does not match the fixed public source request.');
  if (!(response.body instanceof Uint8Array) || response.body.byteLength > (target.adapter === 'google_doc' ? MAX_SOURCE_BYTES : MAX_METADATA_BYTES)) fail('unsupported_format', 'The public response exceeds the source byte limit.');
  if (response.status === 404 || response.status === 410) fail('not_found', 'The public endpoint reported that this source was not found. This is not a judgment about the cited claim.');
  if (response.status !== 200) fail('unavailable', 'The public endpoint is unavailable or requires access not available to this credential-free check.');
  checkedHeaders(response.headers);
  return decode(response.body);
}

/** Calls only fixed public adapters; successful retrieval still leaves all scientific claims unverified. */
export async function retrieveSource(input: SourceTarget, transport: SourceTransport = (target, deadlineAt, remainingBytes) => boundedHttps(target, { deadlineAt, maxBytes: remainingBytes }),
  callerDeadlineAt?: number): Promise<SourceRetrieval> {
  const observed_at = new Date().toISOString();
  const base = canonicalSource(input.canonical);
  const common = { canonical: base.canonical, adapter: base.adapter, method: 'public-https-v1' as const, observed_at };
  let response_status: number | undefined;
  if (base.adapter === 'drive_folder') return { ...common, status: 'unsupported',
    reason: 'A stable credential-free public collection listing is not supported; no child documents were checked.',
    fix: 'Provide an individual public document or GitHub text file for the material needed to assess your statement.' };
  if (base.adapter === 'github' && !SHA.test(base.identity.ref)) return { ...common, status: 'unsupported',
    reason: 'Automatic GitHub retrieval requires a full 40-character commit SHA; a branch URL is not immutable source evidence.',
    fix: 'Use GitHub Copy permalink to obtain a /blob/<full commit SHA>/ URL, then explicitly check that URL. A historical operator observation is not a fresh immutable retrieval.' };
  const deadlineAt = Math.min(Date.now() + SOURCE_DEADLINE_MS, callerDeadlineAt ?? Infinity);
  if (!Number.isFinite(deadlineAt) || deadlineAt <= Date.now()) return { ...common, status: 'unavailable', reason: 'The source retrieval deadline has expired.', fix: 'Keep your draft and explicitly check the public source again later.' };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new RetrievalError('unavailable', 'The absolute public source retrieval deadline expired.')), Math.max(0, deadlineAt - Date.now()));
  let consumed = 0;
  const get = async (target: SourceTarget) => {
    if (controller.signal.aborted || Date.now() >= deadlineAt) fail('unavailable', 'The absolute public source retrieval deadline expired.');
    const remainingBytes = MAX_RETRIEVAL_BYTES - consumed;
    if (remainingBytes <= 0) fail('unavailable', 'The whole-check source byte budget is exhausted.');
    const response = await abortable(transport(target, deadlineAt, remainingBytes), controller.signal);
    if (controller.signal.aborted || Date.now() >= deadlineAt) fail('unavailable', 'The absolute public source retrieval deadline expired.');
    consumed += response.body.byteLength;
    if (consumed > MAX_RETRIEVAL_BYTES) fail('unsupported_format', 'The whole-check source byte limit was exceeded.');
    response_status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : undefined; const text = checkedResponse(response, target); return { response, text };
  };
  try {
    if (base.adapter === 'github') {
      const resolved_commit = base.identity.ref;
      const git = async (phase: SourceTarget['phase'], binding: Record<string, string>) => {
        const target: SourceTarget = { ...base, phase, identity: { ...base.identity, ...binding }, requestUrl: '' };
        target.requestUrl = githubRequest(target);
        const fetched = await get(target);
        if (!['application/json', 'application/vnd.github+json'].includes(contentType(fetched.response))) fail('unsupported_format', 'GitHub did not return the bounded Git object JSON format.');
        return { ...fetched, data: object(fetched.text) };
      };
      const commitObject = await git('github_commit_object', { resolved_commit });
      const tree = commitObject.data.tree;
      if (commitObject.data.sha !== resolved_commit || !tree || typeof tree !== 'object' || Array.isArray(tree)
        || !SHA.test(String((tree as Record<string, unknown>).sha ?? ''))) fail('identity_mismatch', 'The Git commit object did not bind the resolved commit to its root tree.');
      const root_tree_sha = (tree as { sha: string }).sha;
      const { ref: requested_ref, path } = base.identity;
      const segments = path.split('/'); let tree_sha = root_tree_sha, blob_sha = '', file_mode: '100644' | '100755' | undefined;
      for (let index = 0; index < segments.length; index++) {
        const current = await git('github_tree', { tree_sha });
        if (current.data.sha !== tree_sha || current.data.truncated !== false || !Array.isArray(current.data.tree)) fail('identity_mismatch', 'The Git tree response was incomplete or did not match the requested tree.');
        const matches = (current.data.tree as unknown[]).filter((entry: unknown) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).path === segments[index]);
        if (matches.length !== 1) fail('identity_mismatch', 'The exact requested path was not present unambiguously in the Git tree.');
        const entry = matches[0] as Record<string, unknown>;
        if (typeof entry.sha !== 'string' || !SHA.test(entry.sha)) fail('identity_mismatch', 'The Git tree entry did not identify a bounded Git object.');
        if (index < segments.length - 1) {
          if (entry.type !== 'tree' || entry.mode !== '040000') fail('unsupported_format', 'The requested Git path is not an ordinary tree path; no link or submodule was followed.');
          tree_sha = entry.sha as string;
        } else {
          if (entry.type !== 'blob' || typeof entry.mode !== 'string' || !['100644', '100755'].includes(entry.mode)) fail('unsupported_format', 'The requested Git object is not a regular file; no symlink or submodule was followed.');
          if (entry.size !== undefined && (!Number.isSafeInteger(entry.size) || Number(entry.size) > MAX_SOURCE_BYTES || Number(entry.size) < 0)) fail('unsupported_format', 'The Git tree reports a file outside the bounded text limit.');
          blob_sha = entry.sha as string; file_mode = entry.mode as '100644' | '100755';
        }
      }
      const fetched = await git('github_blob', { blob_sha });
      const data = fetched.data;
      if (data.sha !== blob_sha) fail('identity_mismatch', 'The Git blob response did not match the bound tree entry.');
      if (data.encoding !== 'base64' || typeof data.content !== 'string' || !Number.isSafeInteger(data.size) || Number(data.size) < 1 || Number(data.size) > MAX_SOURCE_BYTES) fail('unsupported_format', 'The Git blob is outside the bounded Base64 text-file contract.');
      const clean = (data.content as string).replace(/[\r\n]/g, '');
      if (clean.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)) fail('unsupported_format', 'The Git blob did not contain valid bounded Base64 text.');
      const raw = Buffer.from(clean, 'base64');
      if (raw.byteLength !== data.size || raw.toString('base64') !== clean) fail('identity_mismatch', 'The Git blob size does not match its content.');
      if (createHash('sha1').update(`blob ${raw.byteLength}\0`).update(raw).digest('hex') !== blob_sha) fail('identity_mismatch', 'The returned Git content does not match its blob identity.');
      const excerpt = decode(raw).trim();
      if (excerpt.startsWith('%PDF-')) fail('unsupported_format', 'PDF interpretation is outside the public text-source contract.');
      if (!excerpt) fail('unsupported_format', 'The public file has no usable text excerpt.');
      return { ...common, status: 'retrieved', response_status, requested_ref, resolved_commit, path, blob_sha, file_mode, root_tree_sha,
        title: short(path, 200), excerpt: short(excerpt, 2000), digest: digest(fetched.response.body),
        reason: 'Retrieved a public regular text file at the resolved GitHub commit. Its scientific claims remain unassessed.',
        fix: 'Review the retrieved excerpt and source version, then explicitly resubmit your discussion for the normal quality check.' };
    }
    const fetched = await get(base);
    if (base.adapter === 'google_doc') {
      if (contentType(fetched.response) !== 'text/plain') fail('unavailable', 'The fixed Google document export did not expose public UTF-8 text; an access wall or unsupported export may be present.');
      const excerpt = fetched.text.trim();
      if (!excerpt) fail('unsupported_format', 'The public Google text export is empty.');
      return { ...common, status: 'retrieved', response_status, excerpt: short(excerpt, 2000), digest: digest(fetched.response.body),
        reason: 'Retrieved the fixed public Google document text export. Its scientific claims remain unassessed.',
        fix: 'Check whether this excerpt contains the specific material your statement relies on, then explicitly resubmit for moderation.' };
    }
    if (contentType(fetched.response) !== 'application/json') fail('unsupported_format', 'The official X oEmbed endpoint did not return its structured format.');
    const data = object(fetched.text);
    if (data.type !== 'rich' || typeof data.html !== 'string' || typeof data.author_name !== 'string' || !data.author_name.trim()
      || !publicAuthor(data.author_url, base.identity.handle)) fail('identity_mismatch', 'The X response did not establish the requested post and reported author identity.');
    const block = embedBlock(data.html as string);
    const anchors = [...htmlTokens(block)].filter((token) => token.name === 'a' && !token.closing).map((token) => attr(token.raw, 'href')).filter((href): href is string => Boolean(href)).map(postIdentity).filter(Boolean);
    if (!anchors.some((anchor) => anchor!.handle === base.identity.handle && anchor!.id === base.identity.id)
      || (data.url !== undefined && (typeof data.url !== 'string' || postIdentity(data.url)?.handle !== base.identity.handle || postIdentity(data.url)?.id !== base.identity.id))) fail('identity_mismatch', 'The X response did not contain the exact requested status URL.');
    const excerpt = inertText(block);
    if (!excerpt) fail('unsupported_format', 'The X response contains no usable inert post text.');
    const author = (data.author_name as string).replace(/\s+/g, ' ').trim();
    if (!author || Buffer.byteLength(author) > MAX_SOURCE_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(author)) fail('unsupported_format', 'The reported author metadata is outside the bounded text contract.');
    if (CREDENTIAL.test(author)) fail('unsupported_format', 'The public response contains credential-shaped text and was not retained.');
    return { ...common, status: 'retrieved', response_status, author: short(author, 100), excerpt: short(excerpt, 2000), digest: digest(fetched.response.body),
      reason: 'Retrieved an official oEmbed response bound to the requested post and its reported author. Authorship and scientific claims are not independently verified.',
      fix: 'Review the attributed post excerpt, then explicitly resubmit your discussion for the ordinary quality gate.' };
  } catch (error) {
    return { ...common, status: error instanceof RetrievalError ? error.status : error instanceof SourceInputError ? 'unsupported' : 'unavailable', response_status,
      reason: error instanceof RetrievalError || error instanceof SourceInputError ? error.message : 'The fixed public endpoint could not complete a bounded source check.',
      fix: 'Keep your draft. Use an individual publicly accessible supported source or retry this explicit check later; unavailable material is not evidence that a claim is false.' };
  } finally { clearTimeout(timer); controller.abort(); }
}
