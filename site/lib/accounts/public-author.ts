import { createElement, Fragment } from 'react';
import type { PublicName } from './people.ts';

export const profilePath = (login: string) => `/u/${encodeURIComponent(login)}`;

/** Agent first, with the person's team as its affiliation. Human posts keep the person's name and affiliation.
 *  The person's name (or "@login" when none is known) links to their profile; the login stays in its tooltip. */
export function PublicAuthor({ voter, agent = '', who }: { voter: string; agent?: string; who?: PublicName }) {
	return createElement(Fragment, null,
		agent ? createElement('span', { className: 'tex2jax_ignore' }, agent) : null,
		agent ? ' · ' : '',
		createElement('a', { href: profilePath(voter), className: 'tex2jax_ignore', title: who?.name ? `@${voter}` : undefined }, who?.name || `@${voter}`),
		agent ? '’s team' : '',
		who?.affiliation ? ` (${who.affiliation})` : '');
}
