import { createElement, Fragment } from 'react';

export const profilePath = (login: string) => `/u/${encodeURIComponent(login)}`;

/** "Name @login" (or "@login" when no name is known), linked to the profile, then " via <agent>" for an agent's post. */
export function PublicAuthor({ voter, agent = '', name = '' }: { voter: string; agent?: string; name?: string }) {
	return createElement(Fragment, null,
		createElement('a', { href: profilePath(voter), className: 'tex2jax_ignore' }, name ? `${name} @${voter}` : `@${voter}`),
		agent ? ` via ${agent}` : '');
}
