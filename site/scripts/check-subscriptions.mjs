// Optional browser check against the disposable npm run dev database and fixture build.
// Requires an installed Playwright (ORI_PLAYWRIGHT_MODULE can point to its index.mjs).
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const base = process.env.ORI_BROWSER_URL ?? 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Only a local disposable site is allowed');
assert.equal(process.env.ORI_LOCAL_SUBSCRIPTIONS_TEST, 'true', 'Opt in to edits of the local-dev test account');
const { chromium } = await import(process.env.ORI_PLAYWRIGHT_MODULE ?? 'playwright');
const captures = process.env.ORI_SCREENSHOT_DIR ?? '/tmp/ori-subscriptions-ui';
await mkdir(captures, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route('**/*', (route) => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const goto = (path) => page.goto(new URL(path, base).href, { waitUntil: 'networkidle' });
const button = (name) => page.getByRole('button', { name, exact: true });

async function save() {
	await Promise.all([
		page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/subscriptions')),
		button('Save subscriptions').click(),
	]);
	await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Saving…'));
	await page.getByRole('status').filter({ hasText: /saved|cleared|session ended/ }).waitFor();
	assert.ok(await page.locator('.category-options label').evaluateAll((labels) => {
		const selected = [...document.querySelectorAll('input[name=category]')].map((i) => i.value);
		return labels.every((label) => label.querySelector('input').checked === selected.includes(label.querySelector('code').textContent));
	}), 'Checkboxes stay consistent with the chosen set after a save or auth interruption');
}

async function choose(code) {
	await page.getByRole('searchbox').fill(code);
	const label = page.locator('.category-options label').filter({ has: page.locator('code', { hasText: new RegExp(`^${code.replace('.', '\\.')}$`) }) });
	await label.getByRole('checkbox').check();
}

try {
	await goto('/');
	await page.getByRole('heading', { name: 'Global feed', exact: true }).waitFor();
	await goto('/auth/github?next=/subscriptions');
	await page.getByRole('heading', { name: 'Your category subscriptions' }).waitFor();
	if (await button('Clear all').count()) await button('Clear all').click();
	await choose('math');
	await choose('quant-ph');
	await save();
	await page.reload({ waitUntil: 'networkidle' });
	assert.equal(await page.locator('input[name=category]').count(), 2, 'Saved preferences survive a reload');
	await page.getByRole('link', { name: 'My feed', exact: true }).click();
	await page.getByRole('heading', { name: 'My feed', exact: true }).waitFor();
	assert.ok(await page.locator('ol > li.item').count() > 0);
	for (const width of [320, 375, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Feed overflow at ${width}px`);
		await page.screenshot({ path: join(captures, `feed-${width}.png`) });
	}
	await page.locator('input[name=q]').fill('source:arxiv OR id:app/absent');
	await page.locator('select[name=sort]').selectOption('newest');
	await button('Search').click();
	await page.waitForURL((url) => url.searchParams.get('q') === 'source:arxiv OR id:app/absent');
	assert.equal(await page.locator('input[name=feed]').inputValue(), 'personal');
	assert.equal(await page.locator('select[name=sort]').inputValue(), 'newest');
	await page.locator('input[name=q]').fill('');
	await button('Search').click();
	await page.waitForURL((url) => !url.searchParams.get('q'));

	await page.getByRole('link', { name: 'Next page', exact: true }).click();
	const oldPage = page.url();
	assert.ok(oldPage.includes('page=2') && oldPage.includes('v='));
	const first = await page.locator('ol > li.item .title').first().getAttribute('href');
	await page.getByRole('link', { name: 'Previous page', exact: true }).click();
	await page.getByRole('link', { name: 'Next page', exact: true }).click();
	assert.equal(await page.locator('ol > li.item .title').first().getAttribute('href'), first);

	await goto('/subscriptions');
	await choose('cs.LG');
	const other = await context.newPage();
	await other.goto(base);
	await other.getByRole('button', { name: 'Sign out', exact: true }).click();
	await save();
	assert.match(await page.getByRole('status').innerText(), /session ended/);
	assert.equal(await page.locator('input[name=category][value="cs.LG"]').count(), 1);
	await other.goto(new URL('/auth/github?next=/subscriptions', base).href);
	await save();
	assert.match(await page.getByRole('status').innerText(), /Subscriptions saved/);
	await goto(oldPage);
	assert.equal(await page.locator('nav[aria-label=Pages] a[aria-current=page]').innerText(), '1');

	await goto('/subscriptions');
	await button('Clear all').click();
	await choose('econ.EM');
	await save();
	await page.getByRole('link', { name: 'View my feed', exact: true }).click();
	await page.getByText('No records match your subscriptions yet.', { exact: false }).waitFor();
	assert.equal(await page.getByText('You haven’t subscribed to any categories.', { exact: false }).count(), 0);
	await goto('/subscriptions');
	for (const width of [320, 375, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await page.getByRole('searchbox').fill('');
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Overflow at ${width}px`);
		await page.screenshot({ path: join(captures, `subscriptions-${width}.png`), fullPage: true });
	}
	await button('Clear all').click();
	await save();
	await goto('/');
	await page.getByRole('heading', { name: 'Global feed', exact: true }).waitFor();
	await page.getByText('You haven’t subscribed to any categories.', { exact: false }).waitFor();
	await goto('/?feed=personal');
	assert.equal(await page.locator('ol > li.item').count(), 0);
	await page.getByText('You haven’t subscribed to any categories.', { exact: false }).waitFor();
	await goto('/?feed=global&q=cat%3Amath&sort=newest');
	assert.equal(await page.locator('input[name=q]').inputValue(), 'cat:math');
	assert.equal(await page.locator('select[name=sort]').inputValue(), 'newest');
	console.log('PASS: defaults, persistence, filter/multi-select, feed, repeated pagination, auth interruption/retry, revision reset, both empty states, removal, search/sort, and 320/375/768/1440px layouts.');
} finally {
	await browser.close();
}
