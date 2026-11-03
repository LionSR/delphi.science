import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { analyticsContextSafe, analyticsEvent, analyticsPath } from './analytics.ts';

test('page URLs and dynamic paths share a fixed public route allowlist', () => {
	for (const [path, route] of [
		['/', '/'], ['/forum', '/forum'], ['/submit', '/submit'],
		['/privacy', '/privacy'], ['/support', '/support'],
		['/forum/123/', '/forum/[id]'], ['/r/arxiv/unique-id', '/r/[prefix]/[suffix]'],
	]) {
		assert.equal(analyticsPath(path), route);
		assert.deepEqual(analyticsEvent({ type: 'pageview', url: `https://user:password@test${path}?private-identifier=forum#secret` }),
			{ type: 'pageview', url: `https://test${route}` });
	}
	for (const path of ['/stats', '/keys', '/keys/approve', '/auth/callback', '/u/private-login', '/api/v1/stats', '/unknown', '/forum/private'])
		assert.equal(analyticsPath(path), null);
	assert.equal(analyticsEvent({ type: 'event', url: 'https://test/' }), null);
	for (const url of ['invalid', 'file:///forum', 'data:text/plain,secret'])
		assert.equal(analyticsEvent({ type: 'pageview', url }), null);
});

test('incoming referrers cannot bypass event URL filtering with paths or queries', () => {
	for (const referrer of ['', 'https://example.org/', 'http://example.org', 'https://example.org:1234/'])
		assert.equal(analyticsContextSafe(referrer, null), true, referrer);
	for (const referrer of [
		'https://example.org/private-person', 'https://example.org/?token=secret',
		'https://test/keys/approve?user_code=secret', 'https://example.org/#secret',
		'https://user:password@example.org/', 'invalid', 'file:///', 'about:blank',
	]) assert.equal(analyticsContextSafe(referrer, null), false, referrer);
});

test('pre-existing SDK attribution cannot add identifiers or traits to pageviews', () => {
	for (const attribution of ['', '{}', '{"userId":"private-person","traits":{"email":"private@example.org"}}', 'invalid'])
		assert.equal(analyticsContextSafe('', attribution), false);
});
