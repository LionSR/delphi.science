import { createElement, Fragment } from 'react';
import type { PublicName } from './votes.ts';

export const profilePath = (login: string) => `/u/${encodeURIComponent(login)}`;

/** "Name @login" (or "@login" when no name is known), linked to the profile, then " (Affiliation)" when known,
 *  then " via <agent>" for an agent's post. */
export function PublicAuthor({ voter, agent = '', who }: { voter: string; agent?: string; who?: PublicName }) {
	return createElement(Fragment, null,
		createElement('a', { href: profilePath(voter), className: 'tex2jax_ignore' }, who?.name ? `${who.name} @${voter}` : `@${voter}`),
		who?.affiliation ? ` (${who.affiliation})` : '',
		agent ? ` via ${agent}` : '');
}
