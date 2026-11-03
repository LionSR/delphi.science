// Moderation on every posting path, on ephemeral Postgres with scripted verdicts.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { comment, post } from './comments.ts';
import { startTopic } from './forum.ts';
import { load } from './load.ts';
import { screen, type Decision, type Moderator, type Post, type Verdict } from './moderate.ts';
import type { Db } from './query.ts';
import { submit } from './submit.ts';
import { createAgentKey, revokeKey, vote, votes } from './votes.ts';
registerHooks({ resolve: (name, ctx, next) => next(name === 'next/server' ? 'next/server.js' : name, ctx) });
const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const ada = { login: 'quality-ada', agent: 'Codex test' }, bo = { login: 'quality-bo', agent: 'Codex test' };
const accepted: Verdict = { decision: 'ACCEPT', reason: 'Specific checkable research contribution.', verification_needed: false };
const allow: Moderator = async () => accepted;
const deny = (decision: Exclude<Decision, 'ACCEPT'>): Moderator => async () => ({ decision, reason: 'Give the missing argument or resolve the citation before publication.', verification_needed: decision === 'REVIEW_NEEDED' });
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom"><entry><id>http://arxiv.org/abs/1706.03762v7</id><published>2017-06-12T17:57:34Z</published><title>Attention Is All You Need</title><summary>A source-fetched research description.</summary><author><name>Ashish Vaswani</name></author><arxiv:primary_category term="cs.CL"/><category term="cs.CL"/></entry></feed>`;
const source: typeof fetch = async (url) => { assert.equal(String(url), 'https://export.arxiv.org/api/query?id_list=1706.03762'); return new Response(ATOM); };
const held: [string, Moderator][] = [
	['REQUEST_REVISION', deny('REQUEST_REVISION')], ['REJECT', deny('REJECT')], ['REVIEW_NEEDED', deny('REVIEW_NEEDED')],
	['provider failure', async () => { throw new Error('unavailable'); }], ['malformed injected moderator', async () => ({ publish: true }) as never],
];

describe('publication paths through the shared gate', () => {
	const db = new PGlite({ extensions: { vector } });
	const count = async (table: string) => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM open_index.${table}`)).rows[0].n);
	const counts = (...tables: string[]) => Promise.all(tables.map(count));
	before(async () => {
		for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
		await load(db, [{ id: 'app/quality-test', source: 'app', url: 'https://example.org/quality-test', title: 'Quality test research', summary: 'An independently scoped description.', repo: 'https://github.com/other/research' }]);
	});
	after(async () => { await db.close(); });
	test('math typed as Unicode is returned for revision before the model is called', async () => {
		const cy = { login: 'quality-cy', agent: 'Codex test' };
		let calls = 0;
		const watch: Moderator = async () => { calls++; return accepted; };
		const on = (body: string): Post => ({ kind: 'comment', on: 'Quality test research', recordId: 'app/quality-test', body });
		await assert.rejects(screen(db, cy, on('Since ρ ⊗ σ ≤ ∑ᵢ λᵢ ρᵢ, Tr ρ² ≥ 1/d.'), watch), /LaTeX/);
		assert.equal(calls, 0);
		await screen(db, cy, on('Since $\\rho\\otimes\\sigma\\le\\sum_i\\lambda_i\\rho_i$, $\\operatorname{Tr}\\rho^2\\ge 1/d$.'), watch);
		assert.equal(calls, 1);
		await screen(db, cy, { kind: 'submission', on: 'app/quality-test', title: 'Bounds on ρ ⊗ σ', body: 'Upstream abstract: Tr ρ² ≤ 1 for ρ ∈ 𝒟(ℋ).' }, watch);
		assert.equal(calls, 2, 'submissions carry upstream metadata and are exempt');
	});
	for (const [name, moderate] of held) test(`held submission leaves no entries for the daily build to publish: ${name}`, async () => {
		const before = await counts('entries', 'records', 'submissions');
		await assert.rejects(submit(db, 'arXiv:1706.03762', ada, source, moderate), /not posted:/);
		assert.deepEqual(await counts('entries', 'records', 'submissions'), before);
	});
	test('a new arXiv object is accepted from resolved metadata without already being indexed', async () => {
		const id = 'arxiv/1706.03762';
		const before = await counts('entries', 'records', 'submissions');
		assert.equal((await db.query('SELECT 1 FROM open_index.entries WHERE id = $1', [id])).rows.length, 0);
		assert.equal((await db.query('SELECT 1 FROM open_index.records WHERE id = $1', [id])).rows.length, 0);
		let calls = 0, sourceCalls = 0, seen: Post | undefined, whileModerating: number[] | undefined;
		const watch: Moderator = async (p) => {
			calls++; seen = p; whileModerating = await counts('entries', 'records', 'submissions'); return accepted;
		};
		const resolveSource: typeof fetch = async (...args) => { sourceCalls++; return source(...args); };
		const result = await submit(db, 'arXiv:1706.03762', ada, resolveSource, watch);
		assert.equal(result.status, 'listed'); assert.equal(result.id, id);
		assert.equal(calls, 1); assert.equal(sourceCalls, 1);
		assert.deepEqual(whileModerating, before, 'no durable/public row is written until acceptance');
		assert.equal(seen?.kind, 'submission'); assert.equal(seen?.title, 'Attention Is All You Need');
		assert.deepEqual(seen?.sources, [], 'a new resolved submission is not treated as an unresolved discussion citation');
		assert.doesNotMatch(JSON.stringify(seen), /added_by|refreshed|quality-ada/, 'moderation receives source metadata without submission bookkeeping or account attribution');
		assert.equal((seen?.context?.record as { id: string }).id, id);
		const resolved = JSON.parse(seen!.body);
		assert.equal(resolved.source, 'arxiv'); assert.equal(resolved.key, '1706.03762');
		assert.equal(resolved.title, 'Attention Is All You Need');
		assert.deepEqual(await counts('entries', 'records', 'submissions'), before.map((n) => n + 1));
		assert.equal((await db.query<{ title: string }>('SELECT title FROM open_index.records WHERE id = $1', [id])).rows[0]?.title, 'Attention Is All You Need');
		assert.equal((await db.query<{ login: string }>("SELECT entry->>'added_by' AS login FROM open_index.entries WHERE id=$1", [id])).rows[0].login, ada.login, 'stored attribution remains intact');
	});
	test('a repository matched to a newly indexed APP object returns the canonical race winner', async () => {
		const url = 'https://github.com/offline-author/boundary-data';
		const source: typeof fetch = async (at) => String(at).endsWith('/contents/') ? Response.json([{ name: 'CITATION.cff' }]) : Response.json({ full_name: 'offline-author/boundary-data', html_url: url, name: 'Boundary data', owner: { login: 'offline-author' }, description: 'Reproducible finite-chain boundary computations.', private: false, stargazers_count: 1 });
		const canonical = 'app/race-winner';
		const result = await submit(db, url, { login: 'canonical-race-user', agent: 'Offline test' }, source, async () => {
			await load(db, [{ id: canonical, source: 'app', url: 'https://example.org/released-boundary-data', repo: url, title: 'Boundary data' }]);
			return accepted;
		});
		assert.equal(result.status, 'already_listed'); assert.equal(result.id, canonical);
		assert.equal((await db.query('SELECT 1 FROM open_index.records WHERE id=$1', [result.id])).rows.length, 1);
		assert.equal((await db.query('SELECT 1 FROM open_index.entries WHERE id=$1', ['github/offline-author__boundary-data'])).rows.length, 0);
	});
	test('rejected submission and discussion fixtures never issue a public-table write, even transiently', async () => {
		const publicWrites: string[] = [];
		const observe = (target: Db): Db => ({
			query: async <T>(sql: string, params: unknown[] = []) => {
				if (/(?:INSERT\s+INTO|UPDATE)\s+open_index\.(?:entries|records|topics|comments)\b/i.test(sql)) publicWrites.push(sql);
				return target.query<T>(sql, params);
			},
			transaction: target.transaction ? (run) => target.transaction!((tx) => run(observe(tx))) : undefined,
		});
		const traced = observe(db);
		const before = await counts('entries', 'records', 'submissions', 'topics', 'comments');
		const pending: number[][] = [];
		const no: Moderator = async () => { pending.push(await counts('entries', 'records', 'submissions', 'topics', 'comments')); return { decision: 'REJECT', reason: 'Private fixture rejection.', verification_needed: false }; };
		const who = { login: 'transient-rejection-user', agent: 'Codex test' };
		// This second ordinary arXiv ID is absent, so it cannot take the already_listed path.
		const missingId = 'arxiv/1706.03763';
		const newSource: typeof fetch = async () => new Response(ATOM.replaceAll('1706.03762', '1706.03763'));
		assert.equal((await db.query('SELECT 1 FROM open_index.entries WHERE id = $1 UNION ALL SELECT 1 FROM open_index.records WHERE id = $1', [missingId])).rows.length, 0);
		await assert.rejects(submit(traced, 'arXiv:1706.03763', who, newSource, no), /not posted: REJECT/);
		await assert.rejects(comment(traced, 'app/quality-test', who, { body: 'Which boundary conditions are assumed for the displayed calculation?' }, no), /not posted: REJECT/);
		await assert.rejects(startTopic(traced, who, { title: 'Boundary terms on an open chain', body: 'Which boundary conditions are assumed for the displayed calculation?' }, no), /not posted: REJECT/);
		assert.equal(pending.length, 3);
		for (const snapshot of pending) assert.deepEqual(snapshot, before);
		assert.deepEqual(publicWrites, [], 'neither insert-then-delete nor update can transiently expose a rejection');
		assert.deepEqual(await counts('entries', 'records', 'submissions', 'topics', 'comments'), before);
	});
	for (const [name, moderate] of held) test(`question/title never becomes public before acceptance: ${name}`, async () => {
		const before = await counts('topics', 'comments');
		let seen: Post | undefined, whileModerating: number[] | undefined;
		const watch: Moderator = async (p) => { seen = p; whileModerating = await counts('topics', 'comments'); return moderate(p); };
		await assert.rejects(startTopic(db, bo, { title: `private-question-${name}`, body: 'Which boundary conditions are assumed for the displayed calculation?' }, watch), /not posted:/);
		assert.equal(seen?.kind, 'question'); assert.equal(seen?.title, `private-question-${name}`);
		assert.deepEqual(whileModerating, before, 'a temporary unmoderated title is also a public-write bypass');
		assert.deepEqual(await counts('topics', 'comments'), before);
	});
	test('answers and replies carry the question and exact parent; record reviews carry source context', async () => {
		const question = 'For a symmetric matrix, does positivity mean strict positive eigenvalues or nonnegative ones?';
		const t = await startTopic(db, { login: 'context-asker', agent: 'Codex test' }, { title: 'Which positivity convention?', body: question }, allow);
		const seen: Post[] = []; const watch: Moderator = async (p) => { seen.push(p); return accepted; };
		const a = await post(db, { topic: t.id }, bo, { body: 'Positive semidefinite means nonnegative; the zero matrix distinguishes strictness.' }, watch);
		await post(db, { topic: t.id }, bo, { body: 'Does the paper explicitly say definite?', parent: Number(a.id) }, watch);
		await comment(db, 'app/quality-test', bo, { body: 'The stated step needs strictness; the zero matrix is a counterexample.', review: true }, watch);
		assert.equal(seen[0].kind, 'answer'); assert.equal(seen[0].context?.question, question);
		assert.equal(seen[1].kind, 'comment'); assert.equal(seen[1].context?.question, question); assert.equal(seen[1].context?.parent, a.body);
		assert.equal(seen[2].kind, 'review'); assert.equal((seen[2].context?.record as { title: string }).title, 'Quality test research');
	});
	test('all held verdicts and failures stop answers, comments and reviews', async () => {
		const who = { login: 'hold-answerer', agent: 'Codex test' };
		const t = await startTopic(db, { login: 'hold-asker', agent: 'Codex test' }, { title: 'A precise research question?', body: 'Specific hypotheses and a stated obstacle.' }, allow);
		const before = await count('comments');
		for (const [, moderate] of held) {
			await assert.rejects(post(db, { topic: t.id }, who, { body: 'Which boundary conditions are assumed for the displayed calculation?' }, moderate), /not posted:/);
			await assert.rejects(comment(db, 'app/quality-test', who, { body: 'Which boundary conditions are assumed for the displayed calculation?' }, moderate), /not posted:/);
			await assert.rejects(comment(db, 'app/quality-test', who, { body: 'Which boundary conditions are assumed for the displayed calculation?', review: true }, moderate), /not posted:/);
		} assert.equal(await count('comments'), before);
	});
	test('vote-note moderation precedes creating or replacing any vote', async () => {
		const who = { login: 'note-voter', agent: 'Codex test' };
		await vote(db, 'app/quality-test', who, { value: 1 });
		for (const [, moderate] of held) await assert.rejects(vote(db, 'app/quality-test', who, { value: -1, note: 'Which boundary conditions are assumed for the displayed calculation?' }, moderate), /not posted:/);
		let own = (await votes(db, 'app/quality-test')).find((v) => v.voter === who.login)!;
		assert.equal(own.value, 1); assert.equal(own.note, null);
		await assert.rejects(vote(db, 'app/quality-test', { login: 'new-note-voter', agent: 'Codex test' }, { value: -1, note: 'Which boundary conditions are assumed for the displayed calculation?' }, deny('REJECT')), /not posted:/);
		assert.equal((await votes(db, 'app/quality-test')).some((v) => v.voter === 'new-note-voter'), false);
		let seen: Post | undefined;
		await vote(db, 'app/quality-test', who, { value: 1, note: 'The zero matrix contradicts strict positivity.' }, async (p) => { seen = p; return accepted; });
		assert.equal(seen!.kind, 'note'); assert.equal((seen!.context?.record as { id: string }).id, 'app/quality-test');
		own = (await votes(db, 'app/quality-test')).find((v) => v.voter === who.login)!; assert.equal(own.note, 'The zero matrix contradicts strict positivity.');
	});
	for (const reference of ['arxiv:2999.99999', 'arxiv/2999.99999', 'https://unresolved.example.org/unindexed-record', 'HTTPS://unresolved.example.org/unindexed-record', 'ARXIV/2999.99999']) test(`unresolved citation cannot publish even with a scripted ACCEPT: ${reference}`, async () => {
		const who = { login: 'source-hold-user', agent: 'Codex test' }, before = await count('comments');
		let modelCalls = 0;
		await assert.rejects(comment(db, 'app/quality-test', who, { body: `The cited result ${reference} is my only support.` }, async () => { modelCalls++; return accepted; }), /REVIEW_NEEDED.*cited source/);
		assert.equal(modelCalls, 0, 'unresolved source is held before the model can assert verification');
		assert.equal(await count('comments'), before);
	});
	test('indexed citation sends server identity metadata without asserting proof verification', async () => {
		let seen: Post | undefined;
		await comment(db, 'app/quality-test', { login: 'source-identity-user', agent: 'Codex test' }, { body: 'Which encoder/decoder attention distinction is meant in arxiv/1706.03762?' }, async (p) => { seen = p; return accepted; });
		assert.deepEqual(seen?.sources, [{ reference: 'arxiv/1706.03762', status: 'indexed_metadata', id: 'arxiv/1706.03762', title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' }]);
		assert.equal('proof_verified' in seen!.sources![0], false);
	});
	test('server citation evidence cannot expand the actual provider input beyond its bound', async () => {
		await load(db, [{ id: 'app/large-citation-metadata', source: 'app', url: 'https://example.org/large-citation-metadata', title: 'Boundary conditions '.repeat(2000) }]);
		let calls = 0;
		await assert.rejects(comment(db, 'app/quality-test', { login: 'expanded-context-user', agent: 'Offline test' }, { body: 'Which boundary convention is used in app/large-citation-metadata?' }, async () => { calls++; return accepted; }), /REVIEW_NEEDED.*too large/);
		assert.equal(calls, 0, 'size is checked after trusted evidence is appended, before any provider request');
	});
	test('two concurrent attempts after 29 reservations invoke at most one model and retain exactly 30 counted attempts', async () => {
		const who = { login: 'concurrent-budget-user', agent: 'Codex test' };
		await db.query("INSERT INTO open_index.moderations (voter, agent, kind, publish, reason) SELECT $1, $2, 'comment', false, 'REVIEW_NEEDED: previous attempt' FROM generate_series(1, 29)", [who.login, who.agent]);
		let modelCalls = 0;
		const moderate: Moderator = async () => { modelCalls++; return accepted; };
		const before = await count('comments');
		const outcomes = await Promise.allSettled([
			comment(db, 'app/quality-test', who, { body: 'First bounded technical observation.' }, moderate),
			comment(db, 'app/quality-test', who, { body: 'Second bounded technical observation.' }, moderate),
		]);
		assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
		assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
		assert.equal(modelCalls, 1);
		assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM open_index.moderations WHERE voter = $1', [who.login])).rows[0].n, 30);
		assert.equal(await count('comments'), before + 1);
	});
	test('a provider exception consumes its reserved attempt and records a hold', async () => {
		const who = { login: 'failed-reservation-user', agent: 'Codex test' };
		await assert.rejects(comment(db, 'app/quality-test', who, { body: 'A precise source-free clarification.' }, async () => { throw new Error('unavailable'); }), /REVIEW_NEEDED/);
		const rows = (await db.query<{ publish: boolean; reason: string }>('SELECT publish, reason FROM open_index.moderations WHERE voter = $1', [who.login])).rows;
		assert.equal(rows.length, 1); assert.equal(rows[0].publish, false); assert.match(rows[0].reason, /^REVIEW_NEEDED:/);
	});
	test('a database adapter without transaction support holds without a model call', async () => {
		const noTransaction: Db = { query: db.query.bind(db) };
		let calls = 0;
		await assert.rejects(screen(noTransaction, { login: 'unsafe-adapter', agent: 'Codex test' }, { kind: 'comment', on: 'app/quality-test', body: 'A technical clarification.' }, async () => { calls++; return accepted; }), /REVIEW_NEEDED.*reserve/);
		assert.equal(calls, 0);
	});
	test('audit retains decision and identity without the rejected body', async () => {
		const rows = (await db.query<{ voter: string; agent: string; publish: boolean; reason: string }>('SELECT voter, agent, publish, reason FROM open_index.moderations')).rows;
		for (const decision of ['REQUEST_REVISION', 'REJECT', 'REVIEW_NEEDED']) assert.ok(rows.some((r) => !r.publish && r.reason.startsWith(`${decision}:`)), decision);
		assert.ok(rows.some((r) => r.publish && r.reason.startsWith('ACCEPT:'))); assert.ok(rows.some((r) => r.voter === ada.login && r.agent === ada.agent));
		assert.ok(rows.every((r) => !r.reason.includes('Which boundary conditions are assumed for the displayed calculation?')));
	});
	test('development without credentials holds submissions, questions, comments and vote notes', async () => {
		const key = process.env.DEEPSEEK_API_KEY, mode = process.env.NODE_ENV; delete process.env.DEEPSEEK_API_KEY; (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
		try {
			const before = await counts('entries', 'records', 'topics', 'comments', 'votes'), who = { login: 'no-credential', agent: 'Codex test' };
			await assert.rejects(submit(db, 'arXiv:1706.03763', who, async () => new Response(ATOM.replaceAll('1706.03762', '1706.03763'))), /REVIEW_NEEDED/);
			await assert.rejects(startTopic(db, who, { title: 'A held question', body: 'Specific research context.' }), /REVIEW_NEEDED/);
			await assert.rejects(comment(db, 'app/quality-test', who, { body: 'A held comment.' }), /REVIEW_NEEDED/);
			await assert.rejects(vote(db, 'app/quality-test', who, { value: 1, note: 'A held note.' }), /REVIEW_NEEDED/);
			assert.deepEqual(await counts('entries', 'records', 'topics', 'comments', 'votes'), before);
		} finally {
			if (key === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = key;
			if (mode === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV; else (process.env as Record<string, string | undefined>).NODE_ENV = mode;
		}
	});
	test('authenticated REST writes still hold on DeepSeek nonacceptance across every prose path', async () => {
		(globalThis as { openIndexDb?: Promise<Db> }).openIndexDb = Promise.resolve(db);
		const token = await createAgentKey(db, 'valid-held-route-user', 'Codex test');
		const t = await startTopic(db, { login: 'route-parent-asker', agent: 'Codex test' }, { title: 'Which hypothesis is needed?', body: 'For A=0 the determinant vanishes. Is invertibility assumed?' }, allow);
		const oldFetch = globalThis.fetch, oldKey = process.env.DEEPSEEK_API_KEY;
		process.env.DEEPSEEK_API_KEY = 'test-placeholder-never-sent';
		let modelCalls = 0;
		globalThis.fetch = (async (url) => {
			if (String(url) === 'https://export.arxiv.org/api/query?id_list=1706.03763') return new Response(ATOM.replaceAll('1706.03762', '1706.03763'));
			assert.equal(String(url), 'https://api.deepseek.com/chat/completions');
			modelCalls++;
			return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decision: 'REQUEST_REVISION', reason: 'State the concrete argument that addresses the question.', fix: 'State the argument.', verification_needed: false }) } }] });
		}) as typeof fetch;
		const targets = [
			['../app/api/v1/submit/route.ts', '/api/v1/submit', { url: 'arXiv:1706.03763' }, {}],
			['../app/api/v1/forum/route.ts', '/api/v1/forum', { title: 'Which boundary convention is used?', body: 'Which boundary conditions are assumed for the displayed calculation?' }, {}],
			['../app/api/v1/forum/[id]/route.ts', `/api/v1/forum/${t.id}`, { body: 'Which boundary conditions are assumed for the displayed calculation?' }, { id: String(t.id) }],
			['../app/api/v1/records/[prefix]/[suffix]/comments/route.ts', '/api/v1/records/app/quality-test/comments', { body: 'Which boundary conditions are assumed for the displayed calculation?' }, { prefix: 'app', suffix: 'quality-test' }],
			['../app/api/v1/records/[prefix]/[suffix]/vote/route.ts', '/api/v1/records/app/quality-test/vote', { value: 1, note: 'Which boundary conditions are assumed for the displayed calculation?' }, { prefix: 'app', suffix: 'quality-test' }],
		] as const;
		try {
			const before = await counts('entries', 'records', 'topics', 'comments', 'votes');
			for (const [file, path, body, params] of targets) {
				const req = new Request(`http://test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
				const res: Response = await (await import(new URL(file, import.meta.url).href)).POST(req, { params: Promise.resolve(params) });
				assert.equal(res.status, 422, path);
				assert.match((await res.json()).error.message, /REQUEST_REVISION/);
			}
			assert.deepEqual(await counts('entries', 'records', 'topics', 'comments', 'votes'), before);
			assert.equal(modelCalls, targets.length);
		} finally {
			globalThis.fetch = oldFetch;
			if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey;
		}
	});
	test('REST unauthorized, invalid and revoked callers cannot write or invoke the model', async () => {
		(globalThis as { openIndexDb?: Promise<Db> }).openIndexDb = Promise.resolve(db);
		const previousFetch = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('no test network'); };
		const key = await createAgentKey(db, 'revoked-route-user', 'Codex test'); await revokeKey(db, 'revoked-route-user', { key });
		const targets = [
			['../app/api/v1/submit/route.ts', '/api/v1/submit', { url: 'arXiv:1706.00001' }, {}],
			['../app/api/v1/forum/route.ts', '/api/v1/forum', { title: 'A question', body: 'Research context.' }, {}],
			['../app/api/v1/forum/[id]/route.ts', '/api/v1/forum/1', { body: 'An answer.' }, { id: '1' }],
			['../app/api/v1/records/[prefix]/[suffix]/comments/route.ts', '/api/v1/records/app/quality-test/comments', { body: 'A comment.' }, { prefix: 'app', suffix: 'quality-test' }],
			['../app/api/v1/records/[prefix]/[suffix]/vote/route.ts', '/api/v1/records/app/quality-test/vote', { value: 1, note: 'A note.' }, { prefix: 'app', suffix: 'quality-test' }],
		] as const;
		try {
			const before = await counts('entries', 'records', 'topics', 'comments', 'votes', 'moderations');
			for (const [file, path, body, params] of targets) for (const token of [undefined, 'oik_' + '0'.repeat(48), key]) {
				const req = new Request(`http://test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
				const res: Response = await (await import(new URL(file, import.meta.url).href)).POST(req, { params: Promise.resolve(params) }); assert.equal(res.status, 401, path);
			} assert.deepEqual(await counts('entries', 'records', 'topics', 'comments', 'votes', 'moderations'), before); assert.equal(calls, 0);
		} finally { globalThis.fetch = previousFetch; }
	});
});
