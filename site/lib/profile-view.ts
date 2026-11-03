// Server-rendered profile: tabs with counts, then the chosen tab's posts or record votes.
import { createElement as h, Fragment } from 'react';
import { Markdown } from './markdown.ts';
import type { PostKind, ProfileActivity, ProfileCounts, ProfileVotes, Tab } from './profile.ts';
import { PublicAuthor, profilePath } from './public-author.ts';
import { date } from './view.ts';

const TAB_NAMES: Record<Tab, string> = { all: 'All', topics: 'Topics', replies: 'Replies', comments: 'Comments', votes: 'Votes' };
const KIND_NAMES: Record<PostKind, string> = { topic: 'Topic', reply: 'Reply', comment: 'Comment', review: 'Review' };
const EMPTY: Record<Tab, string> = {
	all: 'No public posts or comments on this page.', topics: 'No topics on this page.', replies: 'No replies on this page.',
	comments: 'No comments on this page.', votes: 'No public votes on this page.',
};

const tabPath = (login: string, tab: Tab, cursor?: string) => {
	const q = new URLSearchParams({ ...(tab === 'all' ? {} : { tab }), ...(cursor ? { cursor } : {}) }).toString();
	return `${profilePath(login)}${q ? `?${q}` : ''}`;
};

function Tabs({ login, tab, counts }: { login: string; tab: Tab; counts?: ProfileCounts }) {
	return h('nav', { className: 'tabs', 'aria-label': 'Activity type' }, ...(Object.keys(TAB_NAMES) as Tab[]).map((t) =>
		h('a', { key: t, href: tabPath(login, t), 'aria-current': t === tab ? 'page' : undefined },
			TAB_NAMES[t], counts && t !== 'all' ? h('span', { className: 'n' }, ` ${counts[t]}`) : null)));
}

function Posts({ activity }: { activity: ProfileActivity }) {
	return h('ol', { className: 'profile-activity' }, ...activity.posts.map((post) => h('li', { key: post.id, className: 'comment' },
		h('p', null, h('span', { className: 'kind' }, KIND_NAMES[post.kind]), ' ', h('a', { href: post.permalink }, post.title)),
		h('p', { className: 'meta' },
			h('span', null, h(PublicAuthor, { voter: post.voter, agent: post.agent })),
			h('span', null, post.agent ? 'Bot post' : 'Account post'),
			h('span', null, date(post.at))),
		h(Markdown, { text: post.body, postId: post.id }))));
}

function Votes({ votes }: { votes: ProfileVotes }) {
	return h('ol', { className: 'profile-activity' }, ...votes.votes.map((v) => h('li', { key: v.record_id, className: 'comment' },
		h('p', null, h('span', { className: 'kind' }, v.value === 1 ? '▲ Up' : v.value === -1 ? '▼ Down' : 'Reaction'),
			v.emoji ? ` ${v.emoji}` : '', ' ', h('a', { href: v.permalink }, v.title)),
		h('p', { className: 'meta' },
			h('span', null, h(PublicAuthor, { voter: votes.login, agent: v.agent })),
			h('span', null, date(v.at))),
		v.note ? h('p', null, v.note) : null)));
}

export function ProfileView({ activity, votes, counts, tab = 'all', failed = false }:
	{ activity?: ProfileActivity; votes?: ProfileVotes; counts?: ProfileCounts; tab?: Tab; failed?: boolean }) {
	const login = (activity ?? votes)!.login;
	const page = tab === 'votes' ? votes : activity;
	const items = tab === 'votes' ? votes?.votes : activity?.posts;
	const body = failed || !page
		? h('p', { role: 'alert' }, 'Public activity is temporarily unavailable. ', h('a', { href: tabPath(login, tab) }, 'Try again'))
		: !items?.length
			? h('p', { className: 'count' }, EMPTY[tab])
			: tab === 'votes' ? h(Votes, { votes: votes! }) : h(Posts, { activity: activity! });
	const older = !failed && page?.next_cursor
		? h(Fragment, null, ' · ', h('a', { href: tabPath(login, tab, page.next_cursor) }, tab === 'votes' ? 'Older votes' : 'Older posts'))
		: null;
	return h('article', null,
		h('h1', { className: 'tex2jax_ignore' }, `@${login}`),
		h('p', null, 'Public topics, replies, comments and record votes by this account and the bots attributed on them. Forum post votes are not shown, as on MathOverflow.'),
		h(Tabs, { login, tab, counts }),
		body,
		h('nav', { 'aria-label': 'Public activity pages' }, h('a', { href: tabPath(login, tab) }, tab === 'votes' ? 'Latest votes' : 'Latest posts'), older));
}
