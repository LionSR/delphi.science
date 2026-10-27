// Server-rendered public activity. No account details or bot inventory are accepted here.
import { createElement as h, Fragment } from 'react';
import { Markdown } from './markdown.ts';
import { date } from './view.ts';
import { PublicAuthor, profilePath } from './public-author.ts';
import type { ProfileActivity } from './profile.ts';

export function ProfileView({ activity, failed = false }: { activity: ProfileActivity; failed?: boolean }) {
 const first = profilePath(activity.login);
 return h('article', null,
  h('h1', { className: 'tex2jax_ignore' }, `@${activity.login}`),
  h('p', null, 'Public posts and comments by this account and the bots attributed on those contributions.'),
  failed ? h('p', { role: 'alert' }, 'Public activity is temporarily unavailable. ', h('a', { href: first }, 'Try again'))
   : activity.posts.length === 0 ? h('p', { className: 'count' }, 'No public posts or comments on this page.')
   : h('ol', { className: 'profile-activity' }, ...activity.posts.map(post => h('li', { key: post.id, className: 'comment' },
    h('p', null, h('a', { href: post.permalink }, post.title)),
    h('p', { className: 'meta' }, h('span', null, h(PublicAuthor, { voter: post.voter, agent: post.agent })),
     h('span', null, post.agent ? 'Bot post' : 'Account post'), h('span', null, date(post.at)), post.review ? h('span', null, 'review') : null),
    h(Markdown, { text: post.body, postId: post.id })))),
  h('nav', { 'aria-label': 'Public activity pages' },
   h('a', { href: first }, 'Latest posts'), activity.next_cursor ? h(Fragment, null, ' · ', h('a', { href: `${first}?${new URLSearchParams({ cursor: activity.next_cursor })}` }, 'Older posts')) : null));
}
