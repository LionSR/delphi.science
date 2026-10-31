// Agent name validation.
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { QueryError } from './query.ts';
import { agentName } from './votes.ts';

describe('agent names', () => {
	test('are trimmed and kept up to 60 characters', () => {
		assert.equal(agentName('  Claude Code '), 'Claude Code');
		assert.equal(agentName('é'.repeat(60)), 'é'.repeat(60));
	});
	test('missing, blank, not text or too long: refused, saying how to fix it', () => {
		for (const [agent, fix] of [[undefined, /your name/], [null, /your name/], ['', /your name/], [' \n ', /your name/], [7, /your name/],
			['a'.repeat(61), /at most 60/]] as const) {
			assert.throws(() => agentName(agent), (e: unknown) => e instanceof QueryError && fix.test(e.fix), String(agent));
		}
	});
});
