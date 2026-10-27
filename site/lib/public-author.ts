import { createElement, Fragment } from 'react';
export const profilePath = (login: string) => `/u/${encodeURIComponent(login)}`;
/** Attribution comes from the already-public contribution, never a private key inventory. */
export function PublicAuthor({ voter, agent = '' }: { voter: string; agent?: string }) {
 return createElement(Fragment, null, createElement('a', { href: profilePath(voter), className: 'tex2jax_ignore' }, `@${voter}`), agent ? ` via ${agent}` : '');
}
