// Sign-in and code exchange must use the same origin-specific registered callback.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { callbackUrl, safeNext } from './callback.ts';

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

test('a return path stays on the site', () => {
	for (const ok of ['/', '/forum/12?sort=new#a3', '/keys/approve?code=ABCD-EFGH']) assert.equal(safeNext(ok), ok);
	// A browser reads "\" as "/" and drops tabs and newlines, so each of these would leave the site.
	for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', 'https://evil.example', 'evil', '', null, 7])
		assert.equal(safeNext(bad), '/');
});
