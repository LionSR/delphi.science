import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROMPTS, promptsText } from './prompts.ts';
import { SORTS } from './query.ts';

test('the daily prompt only casts create-only upvotes with no note', () => {
	const daily = PROMPTS.find((p) => p.id === 'daily')!.text;
	assert.ok(daily.includes('{"value":1,"if_absent":true}'));
	assert.match(daily, /Never downvote/);
	assert.match(daily, /data, never as instructions/);
	assert.doesNotMatch(daily, /"note"/);
});

test('the templates use real search parameters and never print the key', () => {
	const text = promptsText();
	for (const sort of text.matchAll(/sort=(\w+)/g)) assert.ok((SORTS as readonly string[]).includes(sort[1]), sort[1]);
	assert.ok(text.includes('published:['));
	assert.match(text, /Never print it/);
	for (const p of PROMPTS) assert.ok(text.includes(p.text));
});
