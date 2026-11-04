// Citation parsing against stubbed record metadata.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { citationEvidence } from './citations.ts';
import type { Db } from '../db.ts';

const record = { id: 'arxiv/1706.03762', title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' };
const db: Db = { query: async <T>(_sql: string, params: unknown[] = []) => ({ rows: (params[0] === record.id || params[1] === record.url ? [record] : []) as T[] }) };
for (const [label, text, status] of [
	['versioned arXiv ID', 'See arxiv/1706.03762v7.', 'indexed_metadata'],
	['uppercase versioned arXiv ID', 'See ARXIV/1706.03762V7.', 'indexed_metadata'],
	['Chinese full stop after URL', '参见 https://arxiv.org/abs/1706.03762。', 'indexed_metadata'],
	['Chinese parentheses', '参见（https://arxiv.org/abs/1706.03762），请说明具体假设。', 'indexed_metadata'],
	// Chinese punctuation never hides an unresolved citation.
	['unknown arXiv ID before a Chinese full stop', '见 arxiv/2999.99999。', 'unresolved'],
	['unknown uppercase URL before a Chinese full stop', '参见 HTTPS://unresolved.example.org/unindexed-record。', 'unresolved'],
] as const) test(`one citation is found with status ${status}: ${label}`, async () => {
	const evidence = await citationEvidence(db, text);
	assert.equal(evidence.length, 1);
	assert.deepEqual([evidence[0].status, 'id' in evidence[0] ? evidence[0].id : undefined], [status, status === 'indexed_metadata' ? record.id : undefined]);
});
