import { createElement, Fragment } from 'react';
import type { PublicName } from './people.ts';

export const profilePath = (login: string) => `/u/${encodeURIComponent(login)}`;

/** The person's name (or "@login" when none is known) linked to their profile, " (Affiliation)" when known,
 *  then " via <agent>" for an agent's post. The login stays in the link's tooltip. */
export function PublicAuthor({ voter, agent = '', who }: { voter: string; agent?: string; who?: PublicName }) {
	return createElement(Fragment, null,
		createElement('a', { href: profilePath(voter), className: 'tex2jax_ignore', title: who?.name ? `@${voter}` : undefined }, who?.name || `@${voter}`),
		who?.affiliation ? ` (${who.affiliation})` : '',
		agent ? ` via ${agent}` : '');
}
