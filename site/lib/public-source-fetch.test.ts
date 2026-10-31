// Offline transport/adapter contracts only: no network, model, credentials, or public writes.
import { strict as assert } from 'node:assert';
import { Agent } from 'node:https';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { boundedHttps, canonicalSource, isPublicIPv4, retrieveSource, SourceInputError,
  type Connector, type SourceResponse, type SourceTarget, type SourceTransport } from './public-source-fetch.ts';

const commit = 'a'.repeat(40), rootTree = 'b'.repeat(40), notesTree = 'c'.repeat(40);
const github = `https://github.com/ori-lab/boundaries/blob/${commit}/notes/boundary.md`;
const branchGithub = 'https://github.com/ori-lab/boundaries/blob/main/notes/boundary.md';
const doc = 'https://docs.google.com/document/d/abcdefghijklmno12345/edit';
const post = 'https://x.com/sciencenotes/status/1234567890123456789';
const text = 'For an open chain, the telescoping sum retains the two endpoint terms.';
const bytes = (value: string) => new TextEncoder().encode(value);
const json = (target: SourceTarget, value: unknown, status = 200): SourceResponse => ({ status, headers: { 'content-type': 'application/json' }, body: bytes(JSON.stringify(value)), url: target.requestUrl });
const blob = createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
const blobObject = { encoding: 'base64', size: Buffer.byteLength(text), sha: blob, content: Buffer.from(text).toString('base64') };
const rootObject = { sha: rootTree, truncated: false, tree: [{ path: 'notes', mode: '040000', type: 'tree', sha: notesTree }] };
const notesObject = { sha: notesTree, truncated: false, tree: [{ path: 'boundary.md', mode: '100644', type: 'blob', sha: blob, size: Buffer.byteLength(text) }] };
function githubTransport(change: { commit?: object; root?: object; notes?: object; blob?: object } = {}): SourceTransport {
  return async (target) => json(target, target.phase === 'github_commit_object' ? { sha: commit, tree: { sha: rootTree }, ...change.commit }
      : target.phase === 'github_tree' ? target.identity.tree_sha === rootTree ? { ...rootObject, ...change.root } : { ...notesObject, ...change.notes }
      : { ...blobObject, ...change.blob });
}
function wire(status = 200, headers: Record<string, string> = { 'content-type': 'text/plain' }, chunks: Uint8Array[] = [bytes(text)]) {
  return { status, headers, body: (async function* () { for (const chunk of chunks) yield chunk; })() };
}

test('canonical adapters generate fixed requests and discard only recognized share parameters', () => {
  const g = canonicalSource(`${github}?plain=1`);
  assert.equal(g.canonical, github); assert.equal(g.adapter, 'github');
  assert.equal(g.requestUrl, `https://api.github.com/repos/ori-lab/boundaries/git/commits/${commit}`);
  assert.equal(g.identity.ref, commit); assert.equal(g.identity.path, 'notes/boundary.md');
  const d = canonicalSource(`${doc}?usp=sharing`);
  assert.equal(d.canonical, 'https://docs.google.com/document/d/abcdefghijklmno12345');
  assert.equal(d.requestUrl, 'https://docs.google.com/document/d/abcdefghijklmno12345/export?format=txt');
  assert.equal(canonicalSource('https://drive.google.com/drive/folders/abcdefghijklmno12345?usp=drive_link').adapter, 'drive_folder');
  assert.equal(canonicalSource('https://twitter.com/ScienceNotes/status/1234567890123456789?s=20').canonical, post);
});

for (const [label, url] of [
  ['non-HTTPS', github.replace('https:', 'http:')], ['PDF file', github.replace('boundary.md', 'boundary.pdf')], ['double-encoded path syntax', github.replace('/notes/', '/%252e%252e/')], ['unsupported host', 'https://example.org/paper'],
  ['IP literal', 'https://127.0.0.1/paper'], ['URL credentials', 'https://reader@github.com/ori-lab/boundaries/blob/main/notes.md'],
  ['nondefault port', 'https://github.com:444/ori-lab/boundaries/blob/main/notes.md'],
  ['capability query', `${github}?access_token=sample`], ['unknown share parameter', `${doc}?tab=sample`],
  ['encoded path separator', github.replace('/notes/', '/notes%2F')], ['encoded traversal', github.replace('/notes/', '/%2e%2e/')],
  ['literal traversal', github.replace('/notes/', '/../')], ['fragment', `${github}#L2`], ['ambiguous path', github.replace('/notes/', '//notes/')],
] as const) test(`unsupported input is rejected before transport: ${label}`, () => {
  assert.throws(() => canonicalSource(url), (e) => e instanceof SourceInputError && Boolean(e.fix) && !e.message.includes('access_token'));
});

test('public IPv4 validation rejects private and special-use address ranges', () => {
  for (const ip of ['0.1.2.3', '10.1.2.3', '100.64.1.2', '127.0.0.1', '169.254.1.2', '172.16.1.2', '192.0.0.1', '192.0.2.1', '192.168.1.2', '198.18.1.2', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '999.1.2.3']) assert.equal(isPublicIPv4(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '140.82.112.5', '142.250.1.2']) assert.equal(isPublicIPv4(ip), true, ip);
});

test('the actual HTTPS connector receives a validated pinned lookup, TLS hostname and no ambient credentials', async () => {
  const target = canonicalSource(doc); let connects = 0, lookups = 0;
  const connector: Connector = async (options) => {
    connects++; assert.equal(options.hostname, 'docs.google.com'); assert.equal(options.servername, 'docs.google.com');
    assert.ok(options.agent instanceof Agent); assert.equal(options.agent.options.keepAlive, false); assert.deepEqual(options.agent.options.proxyEnv, {}); assert.equal(options.family, 4); assert.equal(options.autoSelectFamily, false); assert.equal(options.headers.Host, 'docs.google.com'); assert.equal(options.rejectUnauthorized, true); assert.equal(options.port, 443);
    assert.equal(options.headers?.Authorization, undefined); assert.equal(options.headers?.Cookie, undefined);
    assert.equal(options.headers?.['Accept-Encoding'], 'identity');
    assert.equal(options.path, '/document/d/abcdefghijklmno12345/export?format=txt');
    const answer = await new Promise<unknown>((resolve, reject) => options.lookup!('docs.google.com', { all: true }, (error: Error | null, addresses: unknown) => error ? reject(error) : resolve(addresses)));
    assert.deepEqual(answer, [{ address: '8.8.8.8', family: 4 }]);
    return wire();
  };
  const got = await boundedHttps(target, { resolve4: async () => { lookups++; return ['8.8.8.8']; }, connect: connector });
  assert.equal(new TextDecoder().decode(got.body), text); assert.equal(connects, 1); assert.equal(lookups, 1);
});

for (const answer of [['127.0.0.1'], ['8.8.8.8', '10.0.0.1'], [], ['::1']]) test(`nonpublic DNS answers never reach a socket: ${answer.length} answer(s)`, async () => {
  let connects = 0;
  await assert.rejects(boundedHttps(canonicalSource(doc), { resolve4: async () => answer, connect: async () => { connects++; return wire(); } }));
  assert.equal(connects, 0);
});

test('a changed requestUrl cannot expand the adapter request allowlist', async () => {
  let lookups = 0;
  await assert.rejects(boundedHttps({ ...canonicalSource(doc), requestUrl: 'https://example.org/source' }, { resolve4: async () => { lookups++; return ['8.8.8.8']; } }));
  assert.equal(lookups, 0);
});

test('Google provider redirects are re-resolved and pinned while opaque Location queries remain internal', async () => {
  const hosts: string[] = [], addresses: unknown[] = [];
  const result = await boundedHttps(canonicalSource(doc), {
    resolve4: async (host) => { hosts.push(host); return ['8.8.8.8']; },
    connect: async (options) => {
      addresses.push(await new Promise((resolve, reject) => options.lookup!(String(options.hostname), {}, (error: Error | null, address: unknown) => error ? reject(error) : resolve(address))));
      return hosts.length === 1 ? wire(302, { location: 'https://doc-example.googleusercontent.com/export/file?provider_state=temporary' }, []) : wire();
    },
  });
  assert.deepEqual(hosts, ['docs.google.com', 'doc-example.googleusercontent.com']); assert.deepEqual(addresses, ['8.8.8.8', '8.8.8.8']);
  assert.equal(result.url, canonicalSource(doc).requestUrl); assert.ok(!JSON.stringify(result).includes('provider_state'));
});

test('out-of-family redirects and redirect DNS changes are held before another connection', async () => {
  for (const location of ['https://example.org/export', 'http://docs.google.com/export', 'https://docs.google.com:444/export']) {
    let connects = 0;
    await assert.rejects(boundedHttps(canonicalSource(doc), { resolve4: async () => ['8.8.8.8'], connect: async () => { connects++; return wire(302, { location }, []); } }));
    assert.equal(connects, 1);
  }
  let connects = 0;
  await assert.rejects(boundedHttps(canonicalSource(doc), { resolve4: async (host) => host === 'docs.google.com' ? ['8.8.8.8'] : ['127.0.0.1'], connect: async () => { connects++; return wire(302, { location: 'https://doc-example.googleusercontent.com/export/file' }, []); } }));
  assert.equal(connects, 1);
});

test('redirect count, compression, declared and streamed byte bounds fail closed', async () => {
  let calls = 0;
  await assert.rejects(boundedHttps(canonicalSource(doc), { resolve4: async () => ['8.8.8.8'], connect: async () => { calls++; return wire(302, { location: canonicalSource(doc).requestUrl }, []); } }));
  assert.equal(calls, 3);
  for (const response of [wire(200, { 'content-encoding': 'gzip' }), wire(200, { 'content-length': '65537' }), wire(200, {}, [new Uint8Array(32769), new Uint8Array(32769)])]) {
    await assert.rejects(boundedHttps(canonicalSource(doc), { resolve4: async () => ['8.8.8.8'], connect: async () => response }));
  }
});

test('one absolute deadline includes DNS, headers and a stalled response stream', async () => {
  const never = new Promise<never>(() => {});
  await assert.rejects(boundedHttps(canonicalSource(doc), { deadlineMs: 10, resolve4: async () => never }), /deadline/i);
  await assert.rejects(boundedHttps(canonicalSource(doc), { deadlineMs: 10, resolve4: async () => ['8.8.8.8'], connect: async () => never }), /deadline/i);
  await assert.rejects(boundedHttps(canonicalSource(doc), { deadlineMs: 10, resolve4: async () => ['8.8.8.8'], connect: async () => ({ status: 200, headers: {}, body: { [Symbol.asyncIterator]: () => ({ next: async () => never }) } }) }), /deadline/i);
});

test('GitHub binds requested ref to commit, exact tree modes, path and verified UTF-8 blob', async () => {
  const seen: SourceTarget[] = [], deadlines: (number | undefined)[] = [], transport = githubTransport();
  const result = await retrieveSource(canonicalSource(github), async (target, deadline) => {
    seen.push(target); deadlines.push(deadline); return transport(target, deadline);
  });
  assert.equal(result.status, 'retrieved'); assert.equal(result.method, 'public-https-v1'); assert.equal(result.excerpt, text);
  assert.equal(result.requested_ref, commit); assert.equal(result.resolved_commit, commit); assert.equal(result.path, 'notes/boundary.md'); assert.equal(result.blob_sha, blob);
  assert.equal(result.file_mode, '100644'); assert.equal(result.root_tree_sha, rootTree);
  assert.equal(seen[0].requestUrl, `https://api.github.com/repos/ori-lab/boundaries/git/commits/${commit}`);
  assert.equal(seen[1].requestUrl, `https://api.github.com/repos/ori-lab/boundaries/git/trees/${rootTree}`);
  assert.equal(seen[3].requestUrl, `https://api.github.com/repos/ori-lab/boundaries/git/blobs/${blob}`);
  assert.equal(new Set(deadlines).size, 1); assert.match(result.digest!, /^[a-f0-9]{64}$/);
});

for (const [label, changes] of [
  ['wrong commit identity', { commit: { sha: 'd'.repeat(40) } }],
  ['truncated root tree', { root: { truncated: true } }],
  ['missing exact path', { notes: { tree: [] } }],
  ['nonregular leaf mode', { notes: { tree: [{ ...notesObject.tree[0], mode: '120000' }] } }],
  ['submodule mode', { notes: { tree: [{ ...notesObject.tree[0], type: 'commit', mode: '160000' }] } }],
  ['wrong tree identity', { notes: { sha: 'd'.repeat(40) } }],
  ['wrong blob digest', { blob: { sha: 'd'.repeat(40) } }],
  ['invalid Base64', { blob: { content: '*' } }],
  ['wrong encoding', { blob: { encoding: 'none' } }],
  ['wrong declared size', { blob: { size: blobObject.size + 1 } }],
] as const) test(`GitHub holds without a complete object-mode binding: ${label}`, async () => {
  const got = await retrieveSource(canonicalSource(github), githubTransport(changes));
  assert.notEqual(got.status, 'retrieved'); assert.equal(got.excerpt, undefined);
});

test('GitHub path depth is bounded before any metadata call', () => {
  assert.throws(() => canonicalSource('https://github.com/ori-lab/boundaries/blob/main/a/b/c/d/e/f/g/h/notes.md'));
});

test('Google Docs accepts bounded plain UTF-8 only and access walls remain holds', async () => {
  const target = canonicalSource(doc);
  const good = await retrieveSource(target, async (t) => ({ status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: bytes(text), url: t.requestUrl }));
  assert.equal(good.status, 'retrieved'); assert.equal(good.excerpt, text);
  for (const response of [
    { status: 403, headers: { 'content-type': 'text/html' }, body: bytes('Sign in to continue') },
    { status: 200, headers: { 'content-type': 'text/html' }, body: bytes('<title>Sign in</title>') },
    { status: 200, headers: { 'content-type': 'text/plain' }, body: new Uint8Array([255]) },
  ]) {
    const got = await retrieveSource(target, async (t) => ({ ...response, url: t.requestUrl }));
    assert.notEqual(got.status, 'retrieved'); assert.equal(got.excerpt, undefined);
  }
});

test('Drive collections never certify unseen children when no stable public listing contract is available', async () => {
  let calls = 0;
  const got = await retrieveSource(canonicalSource('https://drive.google.com/drive/folders/abcdefghijklmno12345'), async () => { calls++; throw new Error('must not fetch'); });
  assert.equal(got.status, 'unsupported'); assert.match(got.fix, /individual public/i); assert.equal(got.excerpt, undefined); assert.equal(calls, 0);
});

test('X oEmbed binds the returned author and exact post anchor, without requiring a top-level url', async () => {
  const payload = { type: 'rich', provider_name: 'Twitter', author_name: 'Science Notes', author_url: 'https://twitter.com/ScienceNotes', html: '<blockquote class="twitter-tweet"><p>Which endpoint terms remain on an open chain?</p><a href="https://twitter.com/ScienceNotes/status/1234567890123456789">October 27, 2026</a></blockquote>' };
  const got = await retrieveSource(canonicalSource(post), async (target) => json(target, payload));
  assert.equal(got.status, 'retrieved'); assert.equal(got.author, 'Science Notes'); assert.ok(got.excerpt?.includes('endpoint terms'));
  assert.ok(!got.excerpt?.includes('<blockquote')); assert.ok(!got.excerpt?.includes('<script'));
  for (const change of [{ author_url: 'https://twitter.com/OtherNotes' }, { html: payload.html.replace('1234567890123456789', '1234567890123456780') }, { type: 'photo' }]) {
    const held = await retrieveSource(canonicalSource(post), async (target) => json(target, { ...payload, ...change }));
    assert.notEqual(held.status, 'retrieved'); assert.equal(held.excerpt, undefined); assert.equal(held.author, undefined);
  }
});

for (const status of [404, 410, 401, 403, 429, 500]) test(`HTTP ${status} is a precise retrieval result, never a scientific truth judgment`, async () => {
  const got = await retrieveSource(canonicalSource(doc), async (target) => ({ status, headers: {}, body: bytes('unavailable'), url: target.requestUrl }));
  assert.equal(got.status, status === 404 || status === 410 ? 'not_found' : 'unavailable');
  assert.equal(got.response_status, status); assert.equal(got.excerpt, undefined); assert.doesNotMatch(got.reason, /false|fabricat/i);
});

 test('a DNS lookup finishing after the whole deadline cannot start HTTP', async () => {
  let release!: (ips: string[]) => void, calls = 0;
  const pending = new Promise<string[]>((resolve) => { release = resolve; });
  await assert.rejects(boundedHttps(canonicalSource(doc), { deadlineMs: 5, resolve4: async () => pending, connect: async () => { calls++; return wire(); } }), /deadline/i);
  release(['8.8.8.8']); await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 0);
});

test('compression and oversized declared bodies are rejected before consuming a stream', async () => {
  for (const headers of [{ 'content-encoding': 'gzip' }, { 'content-length': '65537' }] as Record<string, string>[]) {
    let reads = 0;
    await assert.rejects(boundedHttps(canonicalSource(doc), { resolve4: async () => ['8.8.8.8'], connect: async () => ({ status: 200, headers, body: (async function* () { reads++; yield bytes(text); })() }) }));
    assert.equal(reads, 0);
  }
  await assert.rejects(boundedHttps(canonicalSource(doc), { resolve4: async () => ['8.8.8.8'], connect: async () => wire(200, { 'content-length': '200' }) }), /incomplete/i);
});

test('the X request uses the current fixed official publish endpoint', () => {
  assert.equal(canonicalSource(post).requestUrl, `https://publish.x.com/oembed?url=${encodeURIComponent(post)}&omit_script=true&dnt=true`);
});

 test('caller deadline bounds the whole source check and expired callers start no transport', async () => {
  let calls = 0;
  const old = await retrieveSource(canonicalSource(doc), async () => { calls++; throw new Error('not called'); }, Date.now() - 1);
  assert.equal(old.status, 'unavailable'); assert.equal(calls, 0);
  const held = await retrieveSource(canonicalSource(doc), async () => { calls++; return new Promise<never>(() => {}); }, Date.now() + 10);
  assert.equal(held.status, 'unavailable');
  // Under CPU contention the short caller deadline can expire before transport dispatch.
  assert.ok(calls === 0 || calls === 1, 'expired work never dispatches or retries extra requests');
});

 test('regular executable blobs are supported, but a non-tree ancestor is not traversed', async () => {
  const executable = await retrieveSource(canonicalSource(github), githubTransport({ notes: { tree: [{ ...notesObject.tree[0], mode: '100755' }] } }));
  assert.equal(executable.status, 'retrieved'); assert.equal(executable.file_mode, '100755');
  const held = await retrieveSource(canonicalSource(github), githubTransport({ root: { tree: [{ ...rootObject.tree[0], type: 'blob', mode: '120000' }] } }));
  assert.equal(held.status, 'unsupported_format'); assert.equal(held.excerpt, undefined);
});

test('GitHub does not follow even an in-family object redirect', async () => {
  let calls = 0;
  await assert.rejects(boundedHttps(canonicalSource(github), { resolve4: async () => ['8.8.8.8'], connect: async () => { calls++; return wire(302, { location: canonicalSource(github).requestUrl }, []); } }));
  assert.equal(calls, 1);
});

test('the total Git object budget is shared across every bounded metadata response', async () => {
  const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'notes.md'];
  const target = canonicalSource(`https://github.com/ori-lab/boundaries/blob/${commit}/${segments.join('/')}`);
  const budgets: number[] = []; let index = 0, blobCalls = 0;
  const got = await retrieveSource(target, async (t, _deadline, remaining) => {
    budgets.push(remaining!);
    if (t.phase === 'github_commit_object') return json(t, { sha: commit, tree: { sha: rootTree }, padding: ' '.repeat(200000) });
    if (t.phase === 'github_tree') {
      const leaf = index === segments.length - 1;
      return json(t, { sha: t.identity.tree_sha, truncated: false, padding: ' '.repeat(200000), tree: [{ path: segments[index++], type: leaf ? 'blob' : 'tree', mode: leaf ? '100644' : '040000', sha: leaf ? blob : index.toString(16).padStart(40, '0') }] });
    }
    blobCalls++; return json(t, blobObject);
  });
  assert.equal(got.status, 'unsupported_format'); assert.match(got.reason, /whole-check/);
  assert.equal(blobCalls, 0); assert.ok(budgets.at(-1)! < budgets[0]);
  await assert.rejects(boundedHttps(canonicalSource(doc), { maxBytes: 10, resolve4: async () => ['8.8.8.8'], connect: async () => wire() }), /byte limit/i);
});

test('all Git calls share a caller deadline, including a stalled later metadata request', async () => {
  let calls = 0;
  const got = await retrieveSource(canonicalSource(github), async (t) => {
    calls++; return calls === 1 ? json(t, { sha: commit, tree: { sha: rootTree } }) : new Promise<never>(() => {});
  }, Date.now() + 10);
  assert.equal(got.status, 'unavailable'); assert.equal(calls, 2);
});

 test('error HTTP status is reported without reading or retaining its response body', async () => {
  let reads = 0;
  const target = canonicalSource(doc);
  const result = await boundedHttps(target, { resolve4: async () => ['8.8.8.8'], connect: async () => ({ status: 404, headers: { 'content-encoding': 'gzip' }, body: (async function* () { reads++; yield bytes('not retained'); })() }) });
  assert.equal(result.status, 404); assert.equal(result.body.byteLength, 0); assert.equal(reads, 0);
  const held = await retrieveSource(target, async () => result);
  assert.equal(held.status, 'not_found'); assert.equal(held.response_status, 404);
});

 test('X excerpts and reported author text respect UTF-16 field bounds without splitting Unicode points', async () => {
  const sample = { type: 'rich', author_name: '学🧮'.repeat(100), author_url: 'https://x.com/sciencenotes', html: `<blockquote><p>${'学🧮'.repeat(1200)}</p><a href="https://x.com/sciencenotes/status/1234567890123456789">Date</a></blockquote>` };
  const got = await retrieveSource(canonicalSource(post), async (target) => json(target, sample));
  assert.equal(got.status, 'retrieved'); assert.ok(got.excerpt!.length <= 2000); assert.ok(got.author!.length <= 100);
  assert.ok(!/[\uD800-\uDBFF]$/.test(got.excerpt!)); assert.ok(!/[\uD800-\uDBFF]$/.test(got.author!));
});

 test('branch references remain canonicalizable for historical lookup but cause no automatic HTTP request', async () => {
  const target = canonicalSource(branchGithub); assert.equal(target.canonical, branchGithub); assert.equal(target.requestUrl, '');
  let calls = 0;
  const got = await retrieveSource(target, async () => { calls++; throw new Error('must not fetch'); });
  assert.equal(got.status, 'unsupported'); assert.match(got.fix, /Copy permalink/); assert.equal(calls, 0);
  await assert.rejects(boundedHttps(target, { resolve4: async () => { calls++; return ['8.8.8.8']; } }));
  assert.equal(calls, 0);
});

 test('deadline checks at phase boundaries stop already-resolved DNS or byte-free streams', async () => {
  let now = 0, calls = 0;
  await assert.rejects(boundedHttps(canonicalSource(doc), { deadlineMs: 10, now: () => now, resolve4: async () => { now = 20; return ['8.8.8.8']; }, connect: async () => { calls++; return wire(); } }), /deadline/i);
  assert.equal(calls, 0);
  now = 0;
  await assert.rejects(boundedHttps(canonicalSource(doc), { deadlineMs: 10, now: () => now, resolve4: async () => ['8.8.8.8'], connect: async () => ({ status: 200, headers: {}, body: (async function* () { while (true) { now++; yield new Uint8Array(); } })() }) }), /deadline/i);
  assert.ok(now <= 10);
});
