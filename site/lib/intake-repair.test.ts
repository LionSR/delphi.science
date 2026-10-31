// Offline regression/security coverage. Scripted moderators are plumbing fixtures, not model-quality evidence.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { boundedHttps, canonicalSource, MAX_METADATA_BYTES, retrieveSource, type Connector, type SourceTransport } from './public-source-fetch.ts';
import { resolve, detect } from './resolve.ts';
import { submit } from './submit.ts';
import { comment, post } from './comments.ts';
import { startTopic } from './forum.ts';
import { load } from './load.ts';
import { parseVerdict, SYSTEM, type Moderator, type Post } from './moderate.ts';
import { citationEvidence } from './moderation-sources.ts';
import { submitPostForm } from './post-form-submit.ts';
import { createAgentKey } from './votes.ts';
import type { Db } from './query.ts';

registerHooks({ resolve: (name, ctx, next) => next(name === 'next/server' ? 'next/server.js' : name, ctx) });
const url = 'https://xiaoliangqi.github.io/blog/posts/what-is-life/';
const page = '<html><head><title>What Is Life? -- Question Revisited in the AI Era</title><meta name="author" content="Page-reported author"><meta name="description" content="A research essay about physical descriptions of living systems."></head><body><script>Never publish script content</script><p>Finite models and their stated limitations.</p></body><!--' + 'inert theme padding '.repeat(4000) + '--></html>';
const bytes = (text: string) => new TextEncoder().encode(text);
const transport: SourceTransport = async target => ({ status: 200, url: target.requestUrl, headers: { 'content-type': 'text/html; charset=utf-8' }, body: bytes(page) });
const accepted = { decision: 'ACCEPT', reason: 'A scoped self-contained research contribution.', fix: '', verification_needed: false } as const;
const allow: Moderator = async () => accepted;
const record = 'app/intake-repair';
const db = new PGlite({ extensions: { vector } });
before(async () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(file, dir), 'utf8'));
  await load(db, [{ id: record, source: 'app', url: 'https://example.org/research', title: 'Finite boundary models' }]);
});
after(async () => { await db.close(); });
const count = async (table: string) => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM open_index.${table}`)).rows[0].n);

test('research blog intake uses bounded inert metadata, canonical URL and the Python Web identity', async () => {
  let genericFetches = 0;
  const entry = (await resolve(url, async () => { genericFetches++; throw new Error('unbounded fetch must never run'); }, transport))!;
  assert.equal(genericFetches, 0);
  assert.equal(entry.source, 'web');
  assert.equal(entry.key, createHash('sha1').update(url).digest('hex').slice(0, 12));
  assert.equal(entry.title, 'What Is Life? -- Question Revisited in the AI Era');
  assert.ok(bytes(page).byteLength > 65_536 && bytes(page).byteLength < MAX_METADATA_BYTES);
  assert.deepEqual(entry.authors, ['Page-reported author']);
  assert.equal(entry.url, url);
  assert.doesNotMatch(JSON.stringify(entry), /Never publish script content|<script>/);
  assert.equal(detect(url)?.source.name, 'web');
});

test('public webpages retain private DNS, mixed DNS, pinning, redirect and byte bounds', async () => {
  const target = canonicalSource(url);
  let connects = 0;
  const connect: Connector = async options => {
    connects++;
    assert.equal(options.hostname, 'xiaoliangqi.github.io');
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers['Accept-Encoding'], 'identity');
    await new Promise<void>((done, reject) => options.lookup!(options.hostname!, {}, (error: unknown, address: unknown) => {
      try { assert.equal(error, null); assert.equal(address, '8.8.8.8'); done(); } catch (e) { reject(e); }
    }));
    return { status: 200, headers: { 'content-type': 'text/html' }, body: (async function* () { yield bytes(page); })() };
  };
  for (const ips of [['127.0.0.1'], ['169.254.169.254'], ['8.8.8.8', '10.0.0.1']]) {
    await assert.rejects(boundedHttps(target, { resolve4: async () => ips, connect }));
  }
  assert.equal(connects, 0);
  await boundedHttps(target, { resolve4: async () => ['8.8.8.8'], connect });
  assert.equal(connects, 1);
  for (const location of ['https://internal.example.org/private', 'https://127.0.0.1/private', 'http://xiaoliangqi.github.io/plain', `${url}?access_token=private`, 'https://jaigp.org/paper/1']) {
    let hops = 0;
    await assert.rejects(boundedHttps(target, { resolve4: async () => ['8.8.8.8'], connect: async () => { hops++; return { status: 302, headers: { location }, body: (async function* () {})() }; } }));
    assert.equal(hops, 1, 'unsafe redirects never reach another socket');
  }
  let lookups = 0;
  await assert.rejects(boundedHttps(target, { resolve4: async () => ++lookups === 1 ? ['8.8.8.8'] : ['192.168.0.1'], connect: async () => ({ status: 302, headers: { location: '/moved' }, body: (async function* () {})() }) }));
  assert.equal(lookups, 2, 'every allowed same-origin redirect is checked again');
  const tooLarge = await retrieveSource(target, async t => ({ status: 200, url: t.requestUrl, headers: { 'content-type': 'text/html' }, body: bytes(page + 'x'.repeat(MAX_METADATA_BYTES)) }));
  assert.equal(tooLarge.status, 'unsupported_format');
  const stalled = await retrieveSource(target, async () => new Promise(() => {}), Date.now() + 10);
  assert.equal(stalled.status, 'unavailable');
});

test('web intake rejects login-only, PDF, missing title, secrets and private/capability URLs', async () => {
  const target = canonicalSource(url);
  for (const [status, type, body] of [
    [403, 'text/html', page], [200, 'application/pdf', '%PDF-1.7'], [200, 'text/html', '<p>No title</p>'],
    [200, 'text/html', page + 'oik_' + 'a'.repeat(48)],
  ] as const) {
    const result = await retrieveSource(target, async t => ({ status, url: t.requestUrl, headers: { 'content-type': type }, body: bytes(body) }));
    assert.notEqual(result.status, 'retrieved');
    assert.equal(result.excerpt, undefined);
  }
  for (const input of ['http://example.org/page', 'https://reader:secret@example.org/page', 'https://127.1/page', 'https://[::1]/page', `${url}?token=secret`, `${url}#private`, 'https://notes.internal/page', 'https://jaigp.org/paper/1']) assert.equal(detect(input), null, input);
  for (const path of ['blob/main/paper.md', 'releases/tag/v1', 'tree/main/src']) assert.equal(detect(`https://github.com/lab/project/${path}`), null);
});

test('web records cannot write before moderation; supplemental context stays attributed and unpersisted', async () => {
  const who = { login: 'web-submitter', agent: 'Offline regression' };
  const before = await count('entries');
  const supplement = 'The author describes a finite physical model; section 2 defines the scope.';
  let seen: Post | undefined;
  await assert.rejects(submit(db, url, who, undefined, async p => {
    seen = p;
    return { decision: 'REQUEST_REVISION', reason: 'The research scope needs context.', fix: 'Describe the model and version.', verification_needed: false };
  }, supplement, transport), /REQUEST_REVISION/);
  assert.equal(await count('entries'), before);
  assert.match(seen!.context!.supplemental!.attribution, /@web-submitter.*unverified/);
  assert.equal(seen!.context!.supplemental!.text, supplement);
  assert.doesNotMatch(seen!.body, /section 2/);
  const stored = await submit(db, url, who, undefined, allow, supplement, transport);
  assert.equal(stored.status, 'listed');
  const entry = (await db.query<{ entry: unknown }>('SELECT entry FROM open_index.entries WHERE id=$1', [stored.id])).rows[0].entry;
  assert.doesNotMatch(JSON.stringify(entry), /supplemental|section 2/);
  let fetches = 0;
  assert.equal((await submit(db, url, who, undefined, allow, '', async t => { fetches++; return transport(t); })).status, 'already_listed');
  assert.equal(fetches, 0);
  const attempts = await count('moderations');
  await assert.rejects(submit(db, url, who, undefined, allow, 'x'.repeat(2001), transport), /2,000/);
  await assert.rejects(submit(db, url, who, undefined, allow, 'oik_' + 'a'.repeat(48), transport), /agent key/);
  assert.equal(await count('moderations'), attempts);
});

test('ancillary unknown links can publish only after an explicit moderator source-role assessment', async () => {
  const body = 'For x=0 both sides vanish, contradicting strict positivity. Optional background: https://example.org/unindexed-note';
  const who = { login: 'source-role-author', agent: 'Offline regression' };
  const before = await count('comments');
  await assert.rejects(comment(db, record, who, { body }, allow), /REVIEW_NEEDED/);
  assert.equal(await count('comments'), before);
  await comment(db, record, who, { body }, async p => {
    assert.equal(p.sources?.[0].status, 'unresolved');
    return { ...accepted, supplemental_sources: [0] };
  });
  for (const roles of [[], [1]]) await assert.rejects(comment(db, record, who, { body }, async () => ({ ...accepted, supplemental_sources: roles })), /REVIEW_NEEDED/);
  await assert.rejects(comment(db, record, who, { body: 'The unproved claim follows only from https://example.org/unindexed-theorem' }, async () => ({ decision: 'REVIEW_NEEDED', reason: 'The claim relies on an essential unavailable theorem.', fix: 'Supply the relevant theorem and independently checked assumptions or give a self-contained argument.', verification_needed: true })), /essential unavailable theorem/);
  assert.match(SYSTEM, /no essential claim depends on it/);
});

test('thirteen-plus references preserve bounded checks and actionable overflow without blanket rejection', async () => {
  let queries = 0;
  const refs = Array.from({ length: 15 }, (_, i) => `https://example.org/background/${i}`);
  const fake: Db = { query: async () => { queries++; return { rows: [] }; } };
  const evidence = await citationEvidence(fake, refs.join(' '));
  assert.equal(queries, 12);
  assert.equal(evidence.length, 13);
  assert.deepEqual(evidence.slice(0, 12).map(s => s.reference), refs.slice(0, 12));
  assert.equal(evidence[12].status, 'not_checked');
  assert.equal('count' in evidence[12] && evidence[12].count, 3);
  assert.match('fix' in evidence[12] ? evidence[12].fix! : '', /essential sources first.*split/);
  const body = 'For x=0 both sides vanish. Optional reading:\n' + refs.join('\n');
  await comment(db, record, { login: 'bibliography-author', agent: '' }, { body }, async () => ({ ...accepted, supplemental_sources: Array.from({ length: 13 }, (_, i) => i) }));
  await assert.rejects(comment(db, record, { login: 'bibliography-author', agent: '' }, { body }, allow), /REVIEW_NEEDED/);
});

test('credential/private references are held before provider calls, including after reference twelve', async () => {
  let models = 0, fetches = 0;
  const who = { login: 'private-source-author', agent: '' };
  const before = await count('comments');
  for (const privateUrl of ['https://reader:secret@example.org/file', 'https://example.org/page?token=private', 'https://127.0.0.1/private', 'https://host.internal/private']) {
    const body = Array.from({ length: 12 }, (_, i) => `https://example.org/${i}`).join(' ') + ' ' + privateUrl;
    await assert.rejects(comment(db, record, who, { body, retrieveSources: true }, async () => { models++; return { ...accepted, supplemental_sources: [0] }; }, async () => { fetches++; throw new Error('must not fetch'); }), /REVIEW_NEEDED/);
  }
  assert.equal(models, 0); assert.equal(fetches, 0);
  assert.equal(await count('comments'), before);
  const audits = (await db.query<{ reason: string }>('SELECT reason FROM open_index.moderations WHERE voter=$1', [who.login])).rows;
  assert.doesNotMatch(JSON.stringify(audits), /reader:secret|token=private|127\.0\.0\.1|host\.internal/);
});

test('forum questions, answers and comments share explicit fresh source checks and the moderation gate', async () => {
  const who = { login: 'forum-check-author', agent: '' };
  let checks = 0;
  const fetchSource = async (t: Parameters<typeof retrieveSource>[0]) => { checks++; return retrieveSource(t, transport); };
  const evidenceGate: Moderator = async p => { assert.equal(p.sources?.[0].status, 'retrieved_public'); return accepted; };
  const q = await startTopic(db, who, { title: 'Which finite model is specified?', body: `Which assumptions define the finite model in ${url}?`, retrieveSources: true }, evidenceGate, fetchSource);
  const a = await post(db, { topic: q.id }, who, { body: `The text in ${url} restricts the proposed interpretation to the stated model.`, retrieveSources: true }, evidenceGate, fetchSource);
  await post(db, { topic: q.id }, who, { body: `Which boundary condition in ${url} is meant?`, parent: Number(a.id), retrieveSources: true }, evidenceGate, fetchSource);
  assert.equal(checks, 3);
  const before = await count('topics');
  await assert.rejects(startTopic(db, who, { title: 'A held source question', body: `What is the scope of ${url}?`, retrieveSources: true }, async () => ({ decision: 'REVIEW_NEEDED', reason: 'The excerpt does not establish the essential assumptions.', fix: 'Supply a precise passage or narrow the question.', verification_needed: true }), fetchSource), /REVIEW_NEEDED/);
  assert.equal(await count('topics'), before);
});

test('forum APIs retain authentication, Origin and closed-body checks for new retrieval options', async () => {
  (globalThis as { openIndexDb?: Promise<Db> }).openIndexDb = Promise.resolve(db);
  try {
    const key = await createAgentKey(db, 'forum-api-author', 'Offline regression');
    const before = await count('moderations');
    for (const path of ['../app/api/v1/forum/route.ts', '../app/api/v1/forum/[id]/route.ts']) {
      const { POST } = await import(new URL(path, import.meta.url).href);
      const at = 'https://open-research-index.vercel.app/api/v1/forum' + (path.includes('[id]') ? '/1' : '');
      for (const [auth, origin, extra, expected] of [[false, undefined, {}, 401], [true, 'https://other.example.org', {}, 403], [true, undefined, { verified: true }, 400]] as const) {
        const headers = { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${key}` } : {}), ...(origin ? { Origin: origin } : {}) };
        const response = await POST(new Request(at, { method: 'POST', headers, body: JSON.stringify({ ...(path.includes('[id]') ? {} : { title: 'Which finite model?' }), body: 'Which boundary assumptions are used?', retrieve_sources: true, ...extra }) }), { params: Promise.resolve({ id: '1' }) });
        assert.equal(response.status, expected);
      }
    }
    assert.equal(await count('moderations'), before);
  } finally { delete (globalThis as { openIndexDb?: Promise<Db> }).openIndexDb; }
});

test('browser submission forwards attributed supplemental context through the real gate', async () => {
  let seen: Post | undefined;
  const fetcher: typeof fetch = async at => String(at).endsWith('/contents/') ? Response.json([]) : Response.json({ full_name: 'lab/new-research', html_url: 'https://github.com/lab/new-research', name: 'new-research', owner: { login: 'lab' }, description: '', private: false, stargazers_count: 0 });
  const location = await submitPostForm(db, { login: 'form-context-author', agent: '' }, { kind: 'submission', title: '', body: 'lab/new-research', review: false, supplemental: 'A finite-chain reproducibility project; the README defines the algorithm.' }, async p => { seen = p; return accepted; }, fetcher);
  assert.match(location, /github\/lab__new-research/);
  assert.match(seen!.context!.supplemental!.attribution, /@form-context-author/);
  assert.equal(JSON.parse(seen!.body).citation_cff, false);
  assert.equal(JSON.parse(seen!.body).summary, undefined);
});

test('malformed or inconsistent source-role classifications cannot authorize publication', () => {
  for (const roles of ['0', [0, 0], [-1], [13], [0.5], Array(14).fill(0)]) assert.throws(() => parseVerdict({ ...accepted, supplemental_sources: roles }));
  assert.throws(() => parseVerdict({ ...accepted, supplemental_sources: [0], verification_needed: true }));
  assert.deepEqual(parseVerdict({ ...accepted, supplemental_sources: [0] }).supplemental_sources, [0]);
});


test('reference priority follows textual order across identifiers and URLs', async () => {
 const text = 'arxiv/1706.03762 ' + Array.from({ length: 13 }, (_, i) => `https://example.org/source/${i}`).join(' ');
 const evidence = await citationEvidence({ query: async () => ({ rows: [] }) }, text);
 assert.equal(evidence[0].reference, 'arxiv/1706.03762');
 assert.equal(evidence[11].reference, 'https://example.org/source/10');
 assert.equal(evidence[12].status, 'not_checked');
});

test('shared daily limits stop new webpage and forum retrieval before any network or model work', async () => {
 const day = new Date().toISOString().slice(0, 10);
 const author = { login: 'web-quota-author', agent: '' };
 for (let i = 0; i < 20; i++) await db.query('INSERT INTO open_index.entries (id,entry) VALUES ($1,$2)', [`web/quota-${i}`, { key: `quota-${i}`, source: 'web', url: `https://example.org/quota-${i}`, title: 'A test research record', added: day, added_by: author.login }]);
 let work = 0;
 await assert.rejects(submit(db, 'https://example.org/new-quota-page', author, undefined, async () => { work++; return accepted; }, '', async t => { work++; return transport(t); }), /20 links today/);
 const forumAuthor = { login: 'forum-quota-author', agent: '' };
 await db.query("INSERT INTO open_index.moderations (voter,agent,kind,publish,reason) SELECT $1,'','question',false,'Offline previous attempt' FROM generate_series(1,30)", [forumAuthor.login]);
 await assert.rejects(startTopic(db, forumAuthor, { title: 'Which model?', body: `Which assumptions apply in ${url}?`, retrieveSources: true }, async () => { work++; return accepted; }, async t => { work++; return retrieveSource(t, transport); }), /30/);
 assert.equal(work, 0);
});
