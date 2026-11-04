import { createElement, Fragment } from 'react';
import { profilePath } from './public-author.ts';
import type { Person } from './keys.ts';

export function AccountNavigation({ person }: { person: Person }) {
	return createElement(Fragment, null,
		createElement('a', { href: profilePath(person.login), title: `@${person.login}`, className: 'tex2jax_ignore' }, 'Profile'), ' ',
		createElement('a', { href: '/keys' }, 'Connect an agent'), ' ',
		createElement('button', { className: 'link' }, 'Sign out'));
}
