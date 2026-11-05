import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pageInfo, pageSize, pageStart } from '#lib/paging.ts';

const size = pageSize('Items', 50, 20);

test('a page number and the cursor before it start at the same place; the reply says where it is', () => {
	assert.deepEqual(pageStart({}, size), { offset: 0, limit: 20 });
	assert.deepEqual(pageStart({ page: 3, limit: 10 }, size), { offset: 20, limit: 10 });
	const first = pageInfo(pageStart({}, size), 45, 20);
	assert.deepEqual([first.total, first.page, first.pages], [45, 1, 3]);
	assert.deepEqual(pageStart({ cursor: first.next_cursor, page: 9 }, size), { offset: 20, limit: 20, total: 45 }, 'the cursor wins and carries the total');
	assert.equal(pageInfo({ offset: 40, limit: 20 }, 45, 5).next_cursor, null, 'the last page has no next');
	assert.deepEqual(pageInfo({ offset: 0, limit: 20 }, 0, 0), { total: 0, page: 1, pages: 1, next_cursor: null });
	assert.deepEqual(pageStart({ cursor: btoa(JSON.stringify({ o: 40, t: 45 })) }, size).offset, 40, 'older cursors, in standard base64, still read');
	assert.throws(() => pageStart({ cursor: 'nonsense!' }, size), /cursor is not valid/);
	assert.throws(() => pageStart({ limit: 51 }, size), /limit must be from 1 to 50/);
});
