import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CodedError } from '#lib/errors.ts';
import { load } from '#lib/records/load.ts';
import { migratedDb } from '#lib/testing.ts';
import { unvote, vote, votes } from './votes.ts';

const records = Array.from({ length: 7 }, (_, i) => ({
	id: `arxiv/2611.1234${i}`, source: 'arxiv', title: `Test paper ${i}`, url: `https://example.org/${i}`,
}));
const manual = { login: 'owner', agent: '' };
const agent = { login: 'owner', agent: 'daily-picks' };
const limited = (error: unknown) => error instanceof CodedError && error.status === 429 && error.code === 'daily_vote_budget_reached';
const created = (result: Awaited<ReturnType<typeof vote>>) => {
	assert.ok('created' in result);
	return result.created;
};
const day = "(statement_timestamp() at time zone 'Europe/Berlin')::date";

test('the account shares a budget across clients; no-op retries and edits do not consume it', async () => {
	const db = await migratedDb();
	try {
		await load(db, records);
		await db.query(`insert into open_index.record_vote_budgets values ('owner', 2, 'Europe/Berlin', ${day})`);
		const up = { value: 1, ifAbsent: true } as const;
		assert.equal(created(await vote(db, records[0].id, agent, up)), true);
		assert.equal(created(await vote(db, records[0].id, manual, up)), false);
		await vote(db, records[0].id, agent, { value: 1, emoji: '👍' });
		await vote(db, records[1].id, manual, { value: 1 });
		assert.equal(created(await vote(db, records[0].id, manual, up)), false, 'retry works even at the limit');
		await assert.rejects(vote(db, records[2].id, agent, up), limited);
		assert.deepEqual(await votes(db, records[2].id), []);
		await unvote(db, records[0].id, manual);
		await assert.rejects(vote(db, records[0].id, agent, up), limited, 'deleting does not refund quota');
		await vote(db, records[3].id, manual, { value: -1 });
		await assert.rejects(vote(db, records[3].id, manual, { value: 1 }), limited, 'promoting a downvote counts');
		assert.equal((await votes(db, records[3].id))[0].value, -1);
		assert.equal(created(await vote(db, records[2].id, { login: 'someone-else', agent: '' }, up)), true);
	} finally { await db.close(); }
});

test('only the configured local day counts and a future cutover stays inactive', async () => {
	const db = await migratedDb();
	try {
		await load(db, records);
		await db.query(`insert into open_index.record_vote_budgets values ('owner', 1, 'Europe/Berlin', ${day} + 1)`);
		await vote(db, records[0].id, agent, { value: 1 });
		assert.deepEqual((await db.query('select used from open_index.record_vote_usage')).rows, []);
		await db.query(`update open_index.record_vote_budgets set starts_on = ${day} - 1`);
		await db.query(`insert into open_index.record_vote_usage values ('owner', ${day} - 1, 1)`);
		await vote(db, records[1].id, manual, { value: 1 });
		await assert.rejects(vote(db, records[2].id, agent, { value: 1 }), limited);
	} finally { await db.close(); }
});
