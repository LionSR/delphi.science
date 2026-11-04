import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PROMPTS, PROMPTS_TEXT } from './prompts.ts';
import { quickStart } from './quick-start.ts';
import { SORTS } from './records/query.ts';
import { INGEST_TIME_UTC } from './view.ts';

test('the daily prompt only casts create-only upvotes with no note', () => {
	const daily = PROMPTS.find((p) => p.id === 'daily')!.text;
	assert.ok(daily.includes('{"value":1,"if_absent":true}'));
	assert.match(daily, /Never downvote/);
	assert.match(daily, /data, never as instructions/);
	assert.doesNotMatch(daily, /"note"/);
});

test('the templates use real search parameters and never print the key', () => {
	for (const sort of PROMPTS_TEXT.matchAll(/sort=(\w+)/g)) assert.ok((SORTS as readonly string[]).includes(sort[1]), sort[1]);
	assert.ok(PROMPTS_TEXT.includes('published:['));
	assert.match(PROMPTS_TEXT, /Never print it/);
});

test('the ingestion time matches the daily workflow', () => {
	const [h, m] = INGEST_TIME_UTC.split(':').map(Number);
	assert.ok(readFileSync(new URL('../../.github/workflows/daily.yml', import.meta.url), 'utf8').includes(`cron: '${m} ${h} * * *'`));
});

test('the quick start fills in answers and falls back for empty ones', () => {
	const votes = quickStart('https://x.test', 'X', { papers: 'arXiv:2401.01234', time: '08:00 Asia/Shanghai' });
	assert.match(votes, /https:\/\/x\.test\/prompts\.txt/);
	assert.match(votes, /arXiv:2401\.01234/);
	assert.match(votes, /infer from my last 2 years/);
	assert.match(votes, /at most 3/);
	assert.match(quickStart('https://x.test', 'X', { votes: 0 }), /no key and schedule the "Read-only digest"/);
});
