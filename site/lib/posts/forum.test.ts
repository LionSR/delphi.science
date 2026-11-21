// The list of records a thread names (namedRecords), over a stand-in database.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Db } from '#lib/db.ts';
import { namedRecords } from './forum.ts';

const TITLES: Record<string, string> = { 'arxiv/1': 'One', 'arxiv/2': 'Two', 'app/3': 'Three' };

/** Answers the one query namedRecords makes, in an order of its own, and records what was asked. */
function fake() {
	const asked: string[][] = [];
	const db: Db = {
		query: async <T,>(_sql: string, params: unknown[] = []) => {
			const ids = params[0] as string[];
			asked.push(ids);
			return { rows: ids.filter((id) => id in TITLES).reverse().map((id) => ({ id, title: TITLES[id] })) as T[] };
		},
	};
	return { db, asked };
}

test('each record once, in the order the thread first names it, with its title', async () => {
	const { db, asked } = fake();
	const posts = [{ mentions: ['arxiv/2'] }, { mentions: [] }, { mentions: ['arxiv/1', 'arxiv/2'] }, { mentions: ['app/3'] }];
	assert.deepEqual(await namedRecords(db, posts), [{ id: 'arxiv/2', title: 'Two' }, { id: 'arxiv/1', title: 'One' }, { id: 'app/3', title: 'Three' }]);
	assert.deepEqual(asked, [['arxiv/2', 'arxiv/1', 'app/3']]);
});

test('a record that is no longer in the index is left out', async () => {
	const { db } = fake();
	assert.deepEqual(await namedRecords(db, [{ mentions: ['arxiv/gone', 'arxiv/1'] }]), [{ id: 'arxiv/1', title: 'One' }]);
});

test('a thread that names nothing asks the database nothing', async () => {
	const { db, asked } = fake();
	assert.deepEqual(await namedRecords(db, [{ mentions: [] }]), []);
	assert.deepEqual(asked, []);
});
