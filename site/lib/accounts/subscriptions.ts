// Private, browser-owned home-feed preferences. No API/agent operation exposes these.
import type { Db } from '#lib/db.ts';
import { QueryError } from '#lib/errors.ts';
import { SUBSCRIPTION_CATEGORIES } from '#lib/records/subscription-categories.ts';
import { pageParam } from '#lib/pager.ts';
import type { Person } from './keys.ts';

export function validateSubscriptions(input: unknown): string[] {
	if (!Array.isArray(input) || input.length > Object.keys(SUBSCRIPTION_CATEGORIES).length ||
		input.some((v) => typeof v !== 'string' || !Object.hasOwn(SUBSCRIPTION_CATEGORIES, v))) {
		throw new QueryError('Choose valid arXiv categories.', 'Use the categories listed below. Uncheck every category to clear your subscriptions.');
	}
	return [...new Set(input as string[])].sort();
}

export async function subscriptionPreferences(d: Db, who: Person | null): Promise<{ categories: string[]; revision: string }> {
	if (!who || who.agent !== '') return { categories: [], revision: '' };
	return (await d.query<{ categories: string[]; revision: string }>(
		'SELECT categories, revision FROM open_index.category_subscriptions WHERE login = $1', [who.login.toLowerCase()])).rows[0] ?? { categories: [], revision: '' };
}

export const subscriptions = async (d: Db, who: Person | null) => (await subscriptionPreferences(d, who)).categories;

export type SubscriptionState = { saved: boolean; message: string; signIn?: boolean };

/** Identity comes only from the active browser session; the form's login is a stale-account guard. */
export async function saveSubscriptions(d: Db, who: Person | null, expectedLogin: unknown, input: unknown): Promise<SubscriptionState> {
	if (!who || who.agent !== '') return { saved: false, signIn: true, message: 'Your session ended. Your choices are kept here. Sign in in a new tab, then return and save again.' };
	if (typeof expectedLogin !== 'string' || expectedLogin.toLowerCase() !== who.login.toLowerCase()) {
		return { saved: false, message: 'The signed-in account changed. Reload this page before editing subscriptions for this account.' };
	}
	const selected = validateSubscriptions(input);
	// One statement replaces the set atomically, including removal. Clearing removes the private row entirely.
	if (!selected.length) await d.query('DELETE FROM open_index.category_subscriptions WHERE login = $1', [who.login.toLowerCase()]);
	else await d.query(`INSERT INTO open_index.category_subscriptions (login, categories) VALUES ($1, $2)
		ON CONFLICT (login) DO UPDATE SET categories = excluded.categories, revision = gen_random_uuid()`, [who.login.toLowerCase(), selected]);
	return { saved: true, message: selected.length ? 'Subscriptions saved. Your home feed is ready.' : 'Subscriptions cleared. Home now shows the global feed.' };
}

/** No preferences means the usual global default; explicitly choosing My feed shows its setup state. */
export function homeFeed(who: Person | null, selected: string[], requested?: string) {
	const feed = who && (requested === 'personal' || (requested !== 'global' && selected.length > 0)) ? 'personal' : 'global';
	return { feed, categories: feed === 'personal' ? selected : undefined };
}

/** Old page links cannot carry an offset into a changed subscription set or a different account's feed. */
export function homePage(page: string | undefined, feed: string, requestedRevision: string | undefined, revision: string) {
	return feed === 'personal' && requestedRevision !== revision ? 1 : pageParam(page);
}
