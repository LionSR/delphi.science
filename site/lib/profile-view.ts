// Server-rendered profile: tabs with counts, then the chosen tab's posts or record votes.
import { createElement as h, Fragment } from 'react';
import { Markdown } from './markdown.ts';
import type { PostKind, Profile, ProfilePost, ProfileVote, Tab } from './profile.ts';
import { PublicAuthor, profilePath } from './public-author.ts';
import { date, voteMark } from './view.ts';

const TAB_NAMES: Record<Tab, string> = { all: 'All', topics: 'Topics', replies: 'Replies', comments: 'Comments', votes: 'Votes' };
const KIND_NAMES: Record<PostKind, string> = { question: 'Topic', answer: 'Reply', comment: 'Comment', review: 'Review' };

const tabPath = (login: string, tab: Tab, cursor?: string) => {
	const q = new URLSearchParams({ ...(tab === 'all' ? {} : { tab }), ...(cursor ? { cursor } : {}) }).toString();
	return `${profilePath(login)}${q ? `?${q}` : ''}`;
};

function Tabs({ login, tab, counts }: { login: string; tab: Tab; counts?: Profile['counts'] }) {
	return h('nav', { className: 'tabs', 'aria-label': 'Activity type' }, ...(Object.keys(TAB_NAMES) as Tab[]).map((t) =>
		h('a', { key: t, href: tabPath(login, t), 'aria-current': t === tab ? 'page' : undefined },
			TAB_NAMES[t], counts && t !== 'all' ? h('span', { className: 'n' }, ` ${counts[t]}`) : null)));
}

function Posts({ posts }: { posts: ProfilePost[] }) {
	return h('ol', { className: 'profile-activity' }, ...posts.map((post) => h('li', { key: post.id, className: 'comment' },
		h('p', null, h('span', { className: 'kind' }, KIND_NAMES[post.kind]), ' ', h('a', { href: post.permalink }, post.title)),
		h('p', { className: 'meta' },
			h('span', null, h(PublicAuthor, { voter: post.voter, agent: post.agent })),
			h('span', null, post.agent ? 'Bot post' : 'Account post'),
			h('span', null, date(post.at))),
		h(Markdown, { text: post.body, postId: post.id }))));
}

function Votes({ login, votes }: { login: string; votes: ProfileVote[] }) {
	return h('ol', { className: 'profile-activity' }, ...votes.map((v) => h('li', { key: v.record_id, className: 'comment' },
		h('p', null, h('span', { className: 'kind' }, `${voteMark(v.value)} ${v.value === 1 ? 'Up' : v.value === -1 ? 'Down' : 'Reaction'}`),
			v.emoji ? ` ${v.emoji}` : '', ' ', h('a', { href: v.permalink }, v.title)),
		h('p', { className: 'meta' },
			h('span', null, h(PublicAuthor, { voter: login, agent: v.agent })),
			h('span', null, date(v.at))),
		v.note ? h('p', null, v.note) : null)));
}

/** page is null when loading failed. */
export function ProfileView({ login, tab = 'all', page }: { login: string; tab?: Tab; page: Profile | null }) {
	const noun = tab === 'votes' ? 'votes' : 'posts';
	const empty = tab === 'all' ? 'public posts or comments' : tab === 'votes' ? 'public votes' : TAB_NAMES[tab].toLowerCase();
	const body = !page
		? h('p', { role: 'alert' }, 'Public activity is temporarily unavailable. ', h('a', { href: tabPath(login, tab) }, 'Try again'))
		: !(page.votes ?? page.posts ?? []).length
			? h('p', { className: 'count' }, `No ${empty} on this page.`)
			: page.votes ? h(Votes, { login, votes: page.votes }) : h(Posts, { posts: page.posts! });
	const older = page?.next_cursor
		? h(Fragment, null, ' · ', h('a', { href: tabPath(login, tab, page.next_cursor) }, `Older ${noun}`))
		: null;
	return h('article', null,
		h('h1', { className: 'tex2jax_ignore' }, `@${login}`),
		h('p', null, 'Public topics, replies, comments and record votes by this account and the bots attributed on them. Forum post votes are not shown, as on MathOverflow.'),
		h(Tabs, { login, tab, counts: page?.counts }),
		body,
		h('nav', { 'aria-label': 'Public activity pages' }, h('a', { href: tabPath(login, tab) }, `Latest ${noun}`), older));
}
