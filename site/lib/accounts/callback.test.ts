// The sign-in return address must match the one registered with the GitHub App.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { callbackUrl } from './callback.ts';

test('the plain and www site addresses return to the registered one; other hosts keep their own', () => {
	for (const [origin, site, back] of [
		['https://delphi.science', 'https://delphi.science', 'https://delphi.science'],
		['https://www.delphi.science', 'https://delphi.science', 'https://delphi.science'],
		['https://delphi.science', 'https://www.delphi.science', 'https://www.delphi.science'],
		['http://localhost:3000', 'https://delphi.science', 'http://localhost:3000'],
		['http://delphi.science', 'https://delphi.science', 'http://delphi.science'], // another protocol is another host
	]) assert.equal(callbackUrl(origin, site), `${back}/auth/callback`, `${origin} on ${site}`);
});
