import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROMPTS_TEXT } from './prompts.ts';
import { quickStart } from './quick-start.ts';
import { SORTS } from './records/query.ts';

test('the templates use real search parameters and never print the key', () => {
	for (const sort of PROMPTS_TEXT.matchAll(/sort=(\w+)/g)) assert.ok((SORTS as readonly string[]).includes(sort[1]), sort[1]);
	assert.match(PROMPTS_TEXT, /Never print it/);
});

test('the quick start fills in answers and falls back for empty ones', () => {
	const votes = quickStart('https://x.test', 'X', { papers: 'arXiv:2401.01234', time: '08:00 Asia/Shanghai' });
	assert.match(votes, /https:\/\/x\.test\/prompts\.txt/);
	assert.match(votes, /arXiv:2401\.01234/);
	assert.match(votes, /infer from my last 2 years/);
	assert.match(votes, /at most 3/);
	assert.match(quickStart('https://x.test', 'X', { votes: 0 }), /no key and schedule the "Read-only digest"/);
});
