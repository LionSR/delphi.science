// Cosmetic account label and the explicitly named agent-management destination.
import { createElement, Fragment } from 'react';
import type { Person } from './votes.ts';

export function AccountNavigation({ person }: { person: Person }) {
	return createElement(Fragment, null,
		createElement('span', { title: `@${person.login}`, className: 'tex2jax_ignore' }, person.name || person.login), ' ',
		createElement('a', { href: '/keys' }, 'Connect an agent'), ' ',
		createElement('button', { className: 'link' }, 'Sign out'));
}
