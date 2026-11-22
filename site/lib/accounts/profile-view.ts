// Server-rendered profile: identity, bio/links, tabs with counts, and posts, submissions, record votes, or arXiv papers.
import { createElement as h, type ReactNode } from 'react';
import { Markdown } from '#lib/posts/markdown.ts';
import { arxivAuthorUrl, isOrcid, orcidUrl, type ArxivAuthorFeedResult, type ArxivAuthorPaper } from './arxiv-author.ts';
import type { PostKind, Profile, ProfilePost, ProfileSubmission, ProfileVote, Tab } from './profile.ts';
import { PublicAuthor, profilePath } from './public-author.ts';
import type { PublicName, PublicProfile } from './people.ts';
import { date, original, source, tally, tex, voteMark } from '#lib/view.ts';
import { Pager, pageHref } from '#lib/pager.ts';

export type ProfileTab = Tab | 'papers';
const TAB_NAMES: Record<ProfileTab, string> = {
	all: 'All', topics: 'Topics', replies: 'Replies', comments: 'Comments', submissions: 'Submissions', votes: 'Votes', papers: 'Papers',
};
const KIND_NAMES: Record<PostKind, string> = { question: 'Topic', answer: 'Reply', comment: 'Comment', review: 'Review' };

const tabParams = (tab: ProfileTab) => ({ tab: tab === 'all' ? '' : tab });
const tabPath = (login: string, tab: ProfileTab) => pageHref(profilePath(login), tabParams(tab));

function Tabs({ login, tab, counts, showPapers, papersCount }: {
	login: string; tab: ProfileTab; counts?: Profile['counts']; showPapers: boolean; papersCount?: number;
}) {
	const tabs: ProfileTab[] = showPapers
		? ['all', 'topics', 'replies', 'comments', 'submissions', 'votes', 'papers']
		: ['all', 'topics', 'replies', 'comments', 'submissions', 'votes'];
	return h('nav', { className: 'tabs', 'aria-label': 'Profile sections' }, ...tabs.map((t) => {
		const count = t === 'papers' ? papersCount : (counts && t !== 'all' ? counts[t] : undefined);
		return h('a', { key: t, href: tabPath(login, t), 'aria-current': t === tab ? 'page' : undefined },
			TAB_NAMES[t], typeof count === 'number' ? h('span', { className: 'n' }, ` ${count}`) : null);
	}));
}

function Posts({ posts, who }: { posts: ProfilePost[]; who?: PublicName }) {
	return h('ol', { className: 'profile-activity' }, ...posts.map((post) => h('li', { key: post.id, className: 'comment' },
		h('p', null, h('span', { className: 'kind' }, KIND_NAMES[post.kind]), ' ', h('a', { href: post.permalink }, tex(post.title))),
		h('p', { className: 'meta' },
			h('span', null, h(PublicAuthor, { voter: post.voter, agent: post.agent, who })),
			h('span', null, post.agent ? 'Agent post' : 'Direct post'),
			h('span', null, date(post.at))),
		h(Markdown, { text: post.body, postId: post.id }))));
}

function Submissions({ login, submissions, who }: { login: string; submissions: ProfileSubmission[]; who?: PublicName }) {
	return h('ol', { className: 'profile-activity' }, ...submissions.map((s) => {
		const tag = source(s.record_id.split('/')[0]);
		return h('li', { key: s.id, className: 'comment' },
			h('p', null, h('span', { className: 'kind' }, 'Submission'), ' ', h('a', { href: s.permalink }, tex(s.title))),
			h('p', { className: 'meta' },
				h('a', { className: 'tag', href: tag.href, title: tag.title }, tag.name),
				h('span', null, h(PublicAuthor, { voter: login, agent: s.agent, who })),
				h('span', null, s.agent ? 'Agent submission' : 'Direct submission'),
				h('span', null, date(s.at)),
				h('code', { className: 'tex2jax_ignore' }, s.record_id)));
	}));
}

function Votes({ login, votes, who }: { login: string; votes: ProfileVote[]; who?: PublicName }) {
	return h('ol', { className: 'profile-activity' }, ...votes.map((v) => h('li', { key: v.record_id, className: 'comment' },
		h('p', null, h('span', { className: 'kind' }, `${voteMark(v.value)} ${v.value === 1 ? 'Up' : v.value === -1 ? 'Down' : 'Reaction'}`),
			v.emoji ? ` ${v.emoji}` : '', ' ', h('a', { href: v.permalink }, tex(v.title))),
		h('p', { className: 'meta' },
			h('span', null, h(PublicAuthor, { voter: login, agent: v.agent, who })),
			h('span', null, date(v.at))),
		v.note ? h('p', null, v.note) : null)));
}

function formatAuthors(authors: string[]): string {
	if (authors.length <= 8) return authors.join(', ');
	return `${authors.slice(0, 8).join(', ')} +${authors.length - 8} more`;
}

function PapersList({ arxivId, result }: { arxivId: string; result: ArxivAuthorFeedResult }) {
	const authorHref = arxivAuthorUrl(arxivId);
	if (result.status === 'not_found') {
		return h('p', { className: 'count' },
			'No public arXiv paper feed was found for ', h('code', { className: 'tex2jax_ignore' }, arxivId),
			'. Make sure your public author identifier (or linked ORCID) is enabled in your arXiv account settings.');
	}
	if (result.status === 'unavailable') {
		return h('p', { role: 'alert' }, 'Could not load the arXiv author feed right now. ',
			h('a', { className: 'external', href: authorHref, rel: 'noopener noreferrer' }, 'View on arXiv'));
	}
	if (!result.papers.length) {
		return h('p', { className: 'count' }, 'No papers listed on this arXiv author page yet. ',
			h('a', { className: 'external', href: authorHref, rel: 'noopener noreferrer' }, 'View on arXiv'));
	}
	const indexedCount = result.papers.filter((p) => p.indexed).length;
	return h('section', { 'aria-label': 'arXiv papers' },
		h('p', { className: 'count' },
			`${result.papers.length} ${result.papers.length === 1 ? 'paper' : 'papers'} from arXiv`,
			indexedCount ? ` (${indexedCount} indexed on Delphi)` : '',
			' · ',
			h('a', { className: 'external', href: authorHref, rel: 'noopener noreferrer' }, 'arXiv author page')),
		h('ol', { className: 'profile-papers' }, ...result.papers.map((p: ArxivAuthorPaper) => h('li', { key: p.arxivId, className: 'item' },
			p.indexed
				? h('a', { className: 'title', href: p.indexed.permalink }, tex(p.title))
				: h('a', { className: 'title external', href: p.url, rel: 'noopener noreferrer' }, tex(p.title)),
			p.authors.length ? h('p', { className: 'authors' }, formatAuthors(p.authors)) : null,
			h('p', { className: 'meta' },
				p.indexed ? h('a', { className: 'pill accent', href: p.indexed.permalink }, 'On Delphi') : null,
				p.indexed?.disputed ? h('span', { className: 'pill warn' }, 'Disputed') : null,
				p.category ? h('a', { className: 'tag', href: `/?q=${encodeURIComponent(`cat:${p.category}`)}` }, p.category) : null,
				p.published ? h('span', null, date(p.published)) : null,
				p.indexed ? h('span', null, tally(p.indexed)) : h('code', { className: 'tex2jax_ignore' }, `arXiv:${p.arxivId}`),
				p.indexed ? h('a', { className: 'external', href: p.url, rel: 'noopener noreferrer' }, 'arXiv') : null,
				h('a', { className: 'external', href: p.pdf, rel: 'noopener noreferrer' }, 'PDF'))))));
}

/** page is null when loading failed; who is the person's public profile fields when known; editor is the
 *  owner's form for changing them. */
export function ProfileView({ login, tab = 'all', page, who, papers, connectedAgents, owner = false, editor }: {
	login: string; tab?: ProfileTab; page: Profile | null; who?: Partial<PublicProfile>; papers?: ArxivAuthorFeedResult | null;
	connectedAgents?: number; owner?: boolean; editor?: ReactNode;
}) {
	const arxivId = who?.arxiv_id ?? '';
	const website = who?.url ? original({ url: who.url }) : null;
	const showPapers = Boolean(arxivId || owner || tab === 'papers');
	const papersCount = papers?.status === 'ok' ? papers.papers.length : undefined;

	let body: ReactNode;
	if (tab === 'papers') {
		if (!arxivId) {
			body = h('p', { className: 'count' }, owner
				? 'Add your arXiv public author link or ORCID in Edit profile above to list your papers here.'
				: 'No arXiv author link is set for this account.');
		} else if (!papers) {
			body = h('p', { role: 'alert' }, 'Could not load the arXiv author feed right now. ',
				h('a', { className: 'external', href: arxivAuthorUrl(arxivId), rel: 'noopener noreferrer' }, 'View on arXiv'));
		} else {
			body = h(PapersList, { arxivId, result: papers });
		}
	} else {
		const empty = tab === 'all' ? 'public posts or comments' : tab === 'votes' ? 'public votes' : tab === 'submissions' ? 'submitted records' : TAB_NAMES[tab].toLowerCase();
		const list = page && (page.tab === 'votes'
			? page.votes.length > 0 && h(Votes, { login, votes: page.votes, who: who ? { name: who.name ?? '', affiliation: who.affiliation ?? '' } : undefined })
			: page.tab === 'submissions'
				? page.submissions.length > 0 && h(Submissions, { login, submissions: page.submissions, who: who ? { name: who.name ?? '', affiliation: who.affiliation ?? '' } : undefined })
				: page.posts.length > 0 && h(Posts, { posts: page.posts, who: who ? { name: who.name ?? '', affiliation: who.affiliation ?? '' } : undefined }));
		body = !page
			? h('p', { role: 'alert' }, 'Public activity is temporarily unavailable. ', h('a', { href: tabPath(login, tab) }, 'Try again'))
			: list || h('p', { className: 'count' }, `No ${empty} on this page.`);
	}

	const agentsLabel = typeof connectedAgents === 'number' ? `${connectedAgents} connected ${connectedAgents === 1 ? 'agent' : 'agents'}` : '';
	const agentsBadge = agentsLabel && (owner
		? h('a', { href: connectedAgents ? '/keys#connections' : '/connect', className: `pill ${connectedAgents ? 'accent' : 'muted'}` }, agentsLabel)
		: h('span', { className: `pill ${connectedAgents ? 'accent' : 'muted'}` }, agentsLabel));

	const links: ReactNode[] = [];
	if (website) links.push(h('a', { key: 'url', className: 'external', href: website.href, rel: 'noopener noreferrer ugc' }, website.label));
	if (arxivId) links.push(h('a', { key: 'arxiv', className: 'external', href: arxivAuthorUrl(arxivId), rel: 'noopener noreferrer' }, 'arXiv'));
	if (arxivId && isOrcid(arxivId)) links.push(h('a', { key: 'orcid', className: 'external', href: orcidUrl(arxivId), rel: 'noopener noreferrer' }, `ORCID ${arxivId}`));

	const summaryLine = tab === 'papers'
		? null
		: h('p', { className: who?.bio ? 'count' : 'lead' }, 'Public posts, submissions, and record votes from this account and its connected agents. Individual votes on forum posts are private.');

	return h('article', null,
		who?.name ? h('h1', null, who.name) : h('h1', { className: 'tex2jax_ignore' }, `@${login}`),
		who?.name || who?.affiliation || agentsBadge ? h('p', { className: 'meta' },
			who?.name ? h('span', { className: 'tex2jax_ignore' }, `@${login}`) : null,
			who?.affiliation ? h('span', null, who.affiliation) : null,
			agentsBadge || null) : null,
		links.length ? h('p', { className: 'profile-links' }, ...links) : null,
		who?.bio ? h('p', { className: 'profile-bio' }, who.bio) : null,
		editor ?? null,
		summaryLine,
		h(Tabs, { login, tab, counts: page?.counts, showPapers, papersCount }),
		body,
		tab !== 'papers' && page ? h(Pager, { page: page.page, pages: page.pages, path: profilePath(login), params: tabParams(tab) }) : null);
}
