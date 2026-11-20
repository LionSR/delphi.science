// Post editing on in-process Postgres with scripted moderation verdicts.
import { strict as assert } from 'node:assert';
import { before, beforeEach, after, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { comment, thread } from './comments.ts';
import { editPost } from './edit.ts';
import { EditError } from '#lib/errors.ts';
import { load } from '#lib/records/load.ts';
import type { Moderator } from '#lib/moderation/moderate.ts';
import type { Voter } from '#lib/accounts/keys.ts';
import { migratedDb } from '#lib/testing.ts';
let pg: PGlite;
const bot: Voter = { login: 'edit-owner', agent: 'Research Bot' };
const owner: Voter = { ...bot, agent: '' };
const other: Voter = { login: 'other-owner', agent: bot.agent };
const yes: Moderator = async () => ({ decision: 'ACCEPT', reason: 'Private fixture accepted.', verification_needed: false });
const record = 'app/edit-original';
const fresh = async (who = bot, body = 'The open chain retains its endpoint terms.') => {
	const c = await comment(pg, record, who, { body }, yes);
	return (await thread(pg, { record })).find(p => Number(p.id) === Number(c.id))!;
};
const stored = async (id: number) => (await pg.query<Record<string, unknown>>('SELECT *, xmin::text AS revision FROM open_index.comments WHERE id=$1', [id])).rows[0];
const write = (id: number, revision: string, body = 'The periodic chain cancels both endpoint terms.', who = bot, moderator = yes) => editPost(pg, id, who, { revision, body }, moderator);
before(async () => {
	pg = await migratedDb();
	await load(pg, ['original', 'old', 'new'].map(n => ({ id: `app/edit-${n}`, source: 'app', url: `https://example.org/edit-${n}`, title: 'Endpoint terms' })));
});
beforeEach(async () => { await pg.query('DELETE FROM open_index.moderations'); });
after(async () => { await pg.close(); });

test('the person and any of their agents edit the person\'s posts, whichever agent made them, without changing attribution or metadata', async () => {
	const sibling = { ...bot, agent: 'Other Bot' };
	for (const [author, editor] of [[bot, owner], [owner, owner], [owner, sibling], [bot, sibling]]) {
		const p = await fresh(author), before = await stored(p.id);
		const result = await write(p.id, p.revision, 'The calculation assumes a periodic chain.', editor);
		const after = await stored(p.id);
		for (const field of Object.keys(before).filter(f => !['body', 'tsv', 'revision'].includes(f))) assert.deepEqual(after[field], before[field], field);
		assert.equal(after.body, 'The calculation assumes a periodic chain.');
		assert.equal(result.body, after.body);
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

test('invalid and missing targets cannot be used as an IDOR', async () => {
});
