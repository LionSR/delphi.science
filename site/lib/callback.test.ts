// The sign-in return address must match the one registered with the GitHub App.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { callbackUrl } from './callback.ts';

test('both the plain and www site addresses return to the registered site address', () => {
	for (const origin of ['https://delphi.science', 'https://www.delphi.science'])
		assert.equal(callbackUrl(origin, 'https://delphi.science'), 'https://delphi.science/auth/callback');
	assert.equal(callbackUrl('https://delphi.science', 'https://www.delphi.science'), 'https://www.delphi.science/auth/callback');
});

test('other hosts keep their own address', () => {
	assert.equal(callbackUrl('http://localhost:3000', 'https://delphi.science'), 'http://localhost:3000/auth/callback');
	assert.equal(callbackUrl('https://ori-git-x.vercel.app', 'https://delphi.science'), 'https://ori-git-x.vercel.app/auth/callback');
	assert.equal(callbackUrl('http://delphi.science', 'https://delphi.science'), 'http://delphi.science/auth/callback');
});
