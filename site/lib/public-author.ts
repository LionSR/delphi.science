import { createElement, Fragment } from 'react';

export const profilePath = (login: string) => `/u/${encodeURIComponent(login)}`;

/** "@login", linked to the profile, then " via <agent>" for an agent's post. */
export function PublicAuthor({ voter, agent = '' }: { voter: string; agent?: string }) {
	return createElement(Fragment, null,
		createElement('a', { href: profilePath(voter), className: 'tex2jax_ignore' }, `@${voter}`),
		agent ? ` via ${agent}` : '');
}
