import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pageInfo, pageStart } from '#lib/paging.ts';

test('a page number and the cursor before it start at the same place; the reply says where it is', () => {
	assert.deepEqual(pageStart({}, 20), { offset: 0 });
	assert.deepEqual(pageStart({ page: 3 }, 20), { offset: 40 });
	const first = pageInfo(pageStart({}, 20), 45, 20, 20);
	assert.deepEqual([first.total, first.page, first.pages], [45, 1, 3]);
	assert.deepEqual(pageStart({ cursor: first.next_cursor, page: 9 }, 20), { offset: 20, total: 45 }, 'the cursor wins and carries the total');
	assert.equal(pageInfo({ offset: 40 }, 45, 20, 5).next_cursor, null, 'the last page has no next');
	assert.deepEqual(pageInfo({ offset: 0 }, 0, 20, 0), { total: 0, page: 1, pages: 1, next_cursor: null });
	assert.deepEqual(pageStart({ cursor: btoa(JSON.stringify({ o: 40, t: 45 })) }, 20), { offset: 40, total: 45 }, 'older cursors, in standard base64, still read');
	assert.throws(() => pageStart({ cursor: 'nonsense!' }, 20), /cursor is not valid/);
});
