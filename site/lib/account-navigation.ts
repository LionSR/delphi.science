// Cosmetic account label and the explicitly named agent-management destination.
import { createElement, Fragment } from 'react';
import { profilePath } from './public-author.ts';
import type { Person } from './votes.ts';

export function AccountNavigation({ person }: { person: Person }) {
	return createElement(Fragment, null,
		createElement('a', { href: profilePath(person.login), title: `@${person.login}`, className: 'tex2jax_ignore' }, person.name || person.login), ' ',
		createElement('a', { href: '/keys' }, 'Connect an agent'), ' ',
		createElement('button', { className: 'link' }, 'Sign out'));
}
