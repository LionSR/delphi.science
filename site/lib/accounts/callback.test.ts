// Sign-in and code exchange must use the same origin-specific registered callback.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { callbackUrl } from './callback.ts';

for (const origin of [
	'https://delphi.science',
	'https://www.delphi.science',
	'https://open-research-index-preview.vercel.app',
	'http://localhost:3000',
	'http://127.0.0.1:3000',
	'http://delphi.science',
	'https://delphi.science:8443',
]) {
	test(`sign-in and exchange retain ${origin}`, () => {
		const login = new URL('/auth/github?next=%2Fkeys', origin);
		const returned = new URL('/auth/callback?code=test-code&state=test-state', origin);
		assert.equal(callbackUrl(login.origin), `${origin}/auth/callback`);
		assert.equal(callbackUrl(returned.origin), callbackUrl(login.origin));
	});
}

test('callback address excludes input path, query and fragment', () => {
	assert.equal(callbackUrl('https://www.delphi.science/auth/github?next=/keys#fragment'),
		'https://www.delphi.science/auth/callback');
});

test('rejects malformed URLs', () => {
	assert.throws(() => callbackUrl('not an origin'), TypeError);
});
