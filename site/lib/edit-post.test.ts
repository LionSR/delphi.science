// Post editing on in-process Postgres with scripted moderation verdicts.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { comment, post, thread } from './comments.ts';
import { editPost, type Editor } from './edit-post.ts';
import { EditError } from './post-feedback.ts';
import { startTopic, votePost, accept, topicWithPosts } from './forum.ts';
import { load } from './load.ts';
import type { Moderator, Post } from './moderate.ts';
import { Markdown } from './markdown.ts';
import { createAgentKey, createSession } from './votes.ts';
import type { Db } from './query.ts';
registerHooks({ resolve: (name, ctx, next) => next(name === 'next/server' ? 'next/server.js' : name, ctx) });
const pg = new PGlite({ extensions: { vector } });
const bot: Editor = { login: 'edit-owner', agent: 'Research Bot' };
const owner: Editor = { ...bot, agent: '' };
const other: Editor = { login: 'other-owner', agent: bot.agent };
const yes: Moderator = async () => ({ decision: 'ACCEPT', reason: 'Private fixture accepted.', verification_needed: false });
const record = 'app/edit-original';
const fresh = async (who = bot, body = 'The open chain retains its endpoint terms.') => {
 const c = await comment(pg, record, who, { body }, yes);
 return (await thread(pg, { record })).find(p => Number(p.id) === Number(c.id))!;
};
const stored = async (id: number) => (await pg.query<Record<string, unknown>>('SELECT *, xmin::text AS revision FROM open_index.comments WHERE id=$1', [id])).rows[0];
const write = (id: number, revision: string, body = 'The periodic chain cancels both endpoint terms.', who = bot, moderator = yes) => editPost(pg, id, who, { revision, body }, moderator);
before(async () => {
 const dir = new URL('../supabase/migrations/', import.meta.url);
 for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await pg.exec(readFileSync(new URL(file, dir), 'utf8'));
 await load(pg, ['original', 'old', 'new'].map(n => ({ id: `app/edit-${n}`, source: 'app', url: `https://example.org/edit-${n}`, title: 'Endpoint terms' })));
});
beforeEach(async () => { await pg.query('DELETE FROM open_index.moderations'); });
after(async () => { await pg.close(); });

test('human owner edits own and own-bot bodies without changing attribution or metadata', async () => {
 for (const author of [bot, owner]) {
  const p = await fresh(author), before = await stored(p.id);
  await write(p.id, p.revision, 'The calculation assumes a periodic chain.', owner);
  const after = await stored(p.id);
  for (const field of Object.keys(before).filter(f => !['body', 'tsv', 'revision'].includes(f))) assert.deepEqual(after[field], before[field], field);
  assert.equal(after.body, 'The calculation assumes a periodic chain.');
 }
});

test('ownership boundaries precede moderation, even for no-op retries', async () => {
 const p = await fresh(), human = await fresh(owner); let calls = 0;
 const no: Moderator = async () => { calls++; throw new Error('unauthorized moderation'); };
 for (const [target, who] of [[p, other], [human, other], [p, { ...other, agent: '' }]] as const) {
  await assert.rejects(write(target.id, target.revision, target.body, who, no), e => e instanceof EditError && e.status === 403);
  assert.equal((await stored(target.id)).body, target.body);
 }
 assert.equal(calls, 0);
 await write(p.id, p.revision, 'The authorized bot corrects its own calculation.');
});

test('any of the person\'s agents may edit the person\'s posts and their other agents\' posts, keeping attribution', async () => {
 const human = await fresh(owner), p = await fresh();
 const a = await write(human.id, human.revision, 'The agent fixes a typo in its person\'s post.', { ...bot, agent: 'Other Bot' });
 assert.equal((await stored(human.id)).agent, ''); assert.equal(a.body, 'The agent fixes a typo in its person\'s post.');
 await write(p.id, p.revision, 'A second agent of the same person corrects the first.', { ...bot, agent: 'Other Bot' });
 assert.equal((await stored(p.id)).agent, bot.agent);
});

test('invalid and missing targets cannot be used as an IDOR', async () => {
 for (const id of [0, -1, NaN, 1.1, 999999]) await assert.rejects(write(id, '1'), /no post/);
 const p = await fresh();
 for (const input of [{ body: '', revision: p.revision }, { body: 'x'.repeat(4001), revision: p.revision }, { body: 'valid', revision: '' }, { body: 'valid', revision: '1 OR true' }]) await assert.rejects(editPost(pg, p.id, bot, input, yes), /Send a body/);
 assert.equal((await stored(p.id)).body, p.body);
});

test('rejection and provider failure preserve body and mentions', async () => {
 for (const mode of ['REJECT', 'unavailable'] as const) {
  const p = await fresh(bot, 'Compare app/edit-old.'), before = await stored(p.id);
  const no: Moderator = async () => {
   assert.equal((await stored(p.id)).body, before.body, 'original stays public during checking');
   if (mode === 'unavailable') throw new Error('private failure');
   return { decision: mode, reason: 'Private fixture needs revision.', verification_needed: false };
  };
  await assert.rejects(write(p.id, p.revision, 'Compare app/edit-new.', bot, no), /not posted:/);
  assert.deepEqual(await stored(p.id), before);
  assert.deepEqual((await thread(pg, { record })).find(c => c.id === p.id)?.mentions, ['app/edit-old']);
 }
});

test('accepted edits replace mentions atomically and refresh generated search text', async () => {
 const p = await fresh(bot, 'Compare app/edit-old.');
 const result = await write(p.id, p.revision, 'A telescoping comparison with app/edit-new.');
 assert.deepEqual((await thread(pg, { record })).find(c => c.id === p.id)!.mentions, ['app/edit-new']);
 assert.notEqual(result.revision, p.revision); assert.match(String((await stored(p.id)).tsv), /telescop/);
});

test('stale revisions are refused before moderation, including change-away-and-back saves', async () => {
 const p = await fresh(); const a = await write(p.id, p.revision); await write(p.id, a.revision, p.body);
 await assert.rejects(write(p.id, p.revision, 'An old draft must not overwrite newer work.', bot, async () => { throw new Error('must not call'); }), e => e instanceof EditError && e.code === 'edit_conflict');
 assert.equal((await stored(p.id)).body, p.body);
});

test('a competing save during moderation wins without being overwritten', async () => {
 const p = await fresh();
 const losing: Moderator = async value => { await write(p.id, p.revision, 'The newer accepted edit wins.'); return yes(value); };
 await assert.rejects(write(p.id, p.revision, 'The older draft loses.', bot, losing), e => e instanceof EditError && e.status === 409);
 assert.equal((await stored(p.id)).body, 'The newer accepted edit wins.');
});

test('parallel saves have one winner; identical retries do not moderate or mutate again', async () => {
 const p = await fresh();
 const results = await Promise.allSettled(['First correction.', 'Second correction.'].map(body => write(p.id, p.revision, body)));
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
 assert.equal(results.filter(r => r.status === 'rejected' && r.reason instanceof EditError).length, 1);
 const current = await stored(p.id);
 for (let i = 0; i < 3; i++) await write(p.id, p.revision, String(current.body), bot, async () => { throw new Error('retry must not moderate'); });
 assert.deepEqual(await stored(p.id), current);
});

test('mention failure rolls back the body; nontransactional adapters fail closed', async () => {
 const p = await fresh(), before = await stored(p.id);
 const broken: Db = { query: (sql, params) => pg.query(sql, params), transaction: run => pg.transaction(tx => run({ query: async (sql, params) => {
  if (sql.startsWith('DELETE FROM open_index.mentions')) throw new Error('private mention failure'); return tx.query(sql, params);
 } })) };
 await assert.rejects(editPost(broken, p.id, bot, { body: 'The corrected body.', revision: p.revision }, yes), /mention failure/);
 assert.deepEqual(await stored(p.id), before);
 await assert.rejects(editPost({ query: (sql, params) => pg.query(sql, params) }, p.id, bot, { body: 'The corrected body.', revision: p.revision }, yes), /transaction/);
});

test('question, answer, reply and review edits preserve kind, context, votes and acceptance', async () => {
 const asker = { ...bot, login: 'context-asker' };
 const q = await startTopic(pg, asker, { title: 'Which boundary conditions?', body: 'Does an open chain leave endpoint terms?' }, yes);
 const a = await post(pg, { topic: q.id }, bot, { body: 'The sum telescopes, retaining endpoints.' }, yes);
 await post(pg, { topic: q.id }, bot, { body: 'Does the sum include n=0?', parent: Number(a.id) }, yes);
 await votePost(pg, q.id, Number(a.id), other, 1); await accept(pg, q.id, Number(a.id), asker);
 const seen: Post[] = [];
 for (const p of await thread(pg, { topic: q.id })) await write(p.id, p.revision, `${p.body} Corrected boundary convention.`, { ...owner, login: p.voter }, async value => { seen.push(value); return yes(value); });
 assert.deepEqual(seen.map(p => p.kind), ['question', 'answer', 'comment']);
 assert.match(seen[1].context!.question!, /open chain/); assert.match(seen[2].context!.parent!, /telescopes/);
 const updated = await topicWithPosts(pg, q.id); assert.equal(updated!.accepted_id, Number(a.id)); assert.equal(updated!.answers[0].score, 1);
 const r = await comment(pg, record, bot, { body: 'Equation 2 omits the endpoint term.', review: true }, yes);
 const p = (await thread(pg, { record })).find(p => p.id === Number(r.id))!;
 await write(p.id, p.revision, 'Equation 3 omits the endpoint term.', bot, async value => { assert.equal(value.kind, 'review'); assert.equal((value.context!.record as { id: string }).id, record); return yes(value); });
});

test('edited malicious Markdown still uses the shared sanitizer', async () => {
 const p = await fresh(); await write(p.id, p.revision, 'A **corrected** claim. <script>alert(1)</script> [bad](javascript:alert(1)) ![tracking](https://example.org/edit-new)');
 const html = renderToStaticMarkup(createElement(Markdown, { text: String((await stored(p.id)).body), postId: p.id }));
 assert.match(html, /<strong>corrected<\/strong>/); assert.doesNotMatch(html, /<script|javascript:|<img/);
});

test('PATCH binds credential identity and rejects spoofing, immutable fields and stale saves', async () => {
 const cache = globalThis as { openIndexDb?: Promise<Db> }; cache.openIndexDb = Promise.resolve(pg);
 const { PATCH } = await import('../app/api/v1/posts/[id]/route.ts');
 const key = await createAgentKey(pg, bot.login, bot.agent), sibling = await createAgentKey(pg, bot.login, 'Other Bot'), unrelated = await createAgentKey(pg, other.login, bot.agent), session = await createSession(pg, bot.login);
 const p = await fresh();
 const call = (token: string, data: unknown, id = p.id) => PATCH(new Request(`https://example.org/api/v1/posts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) }), { params: Promise.resolve({ id: String(id) }) });
 const input = { body: 'A specific edited argument.', revision: p.revision };
 assert.equal((await call('', input)).status, 401);
 assert.equal((await call(unrelated, input)).status, 403);
 // The same person's other agent and browser session pass the ownership check (here they stop at moderation, offline).
 for (const token of [sibling, session]) assert.notEqual((await call(token, input)).status, 403);
 assert.equal((await stored(p.id)).body, p.body);
 for (const extra of [{ voter: bot.login }, { login: bot.login }, { human: true }, { agent: bot.agent }, { review: false }, { topic_id: 1 }]) assert.equal((await call(key, { ...input, ...extra })).status, 400);
 assert.equal((await call(key, input, 999999)).status, 404); assert.equal((await call(key, { ...input, revision: '0' })).status, 409);
 const identical = await call(key, { ...input, body: p.body }); assert.equal(identical.status, 200); assert.equal((await identical.json()).revision, p.revision);
 assert.equal((await stored(p.id)).body, p.body); delete cache.openIndexDb;
});
