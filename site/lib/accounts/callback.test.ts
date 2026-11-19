// Sign-in and code exchange must use the same origin-specific registered callback.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { callbackUrl } from './callback.ts';

for (const origin of [
	'https://delphi.science',
	'http://localhost:3000',
]) {
	test(`sign-in and exchange retain ${origin}`, () => {
		const login = new URL('/auth/github?next=%2Fkeys', origin);
		const returned = new URL('/auth/callback?code=test-code&state=test-state', origin);
		assert.equal(callbackUrl(login.origin), `${origin}/auth/callback`);
		assert.equal(callbackUrl(returned.origin), callbackUrl(login.origin));
	});
}
