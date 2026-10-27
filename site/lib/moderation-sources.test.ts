// Citation parsing tests use server metadata stubs only: no URL retrieval or proof verification.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { citationEvidence } from './moderation-sources.ts';
import type { Db } from './query.ts';

const record = { id: 'arxiv/1706.03762', title: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762' };
const db: Db = { query: async <T>(_sql: string, params: unknown[] = []) => ({ rows: (params[0] === record.id || params[1] === record.url ? [record] : []) as T[] }) };
for (const [label, text] of [
	['versioned arXiv ID', 'See arxiv/1706.03762v7.'],
	['uppercase versioned arXiv ID', 'See ARXIV/1706.03762V7.'],
	['Chinese full stop after ID', '见 arxiv/1706.03762。'],
	['Chinese full stop after URL', '参见 https://arxiv.org/abs/1706.03762。'],
	['Chinese quotation brackets', '见「arxiv/1706.03762」中的定义。'],
	['Chinese parentheses', '参见（https://arxiv.org/abs/1706.03762），请说明具体假设。'],
] as const) test(`known citation is not held because of ${label}`, async () => {
	const evidence = await citationEvidence(db, text);
	assert.equal(evidence.length, 1);
	assert.equal(evidence[0].status, 'indexed_metadata');
	assert.equal(evidence[0].id, record.id);
});
for (const text of ['见 arxiv/2999.99999。', '参见 HTTPS://unresolved.example.org/unindexed-record。', '见「arxiv/2999.99999」中的结果。']) test(`Chinese punctuation never hides an unresolved citation: ${text}`, async () => {
	const evidence = await citationEvidence(db, text);
	assert.equal(evidence.length, 1);
	assert.equal(evidence[0].status, 'unresolved');
});
