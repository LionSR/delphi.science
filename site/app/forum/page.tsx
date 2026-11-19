// The forum: research questions and discussions, moderated MathOverflow-style.
import { notFound } from 'next/navigation';
import { db } from '#lib/db.ts';
import { SECTIONS, SECTION_ABOUT, SECTION_IDS, isSection, forumPath } from '#lib/posts/sections.ts';
import { PublicAuthor } from '#lib/accounts/public-author.ts';
import { topics } from '#lib/posts/forum.ts';
import { FORUM } from '#lib/posts/visibility.ts';
import { me } from '#lib/accounts/session.ts';
import { publicNames } from '#lib/accounts/people.ts';
import { date } from '#lib/view.ts';
import { PostForm } from '#app/post-form.tsx';
import { Pager, PAGE_SIZE, pageParam } from '#lib/pager.ts';

export const dynamic = 'force-dynamic';
// The forum's posts as a feed (lib/posts/atom.ts).
export const metadata = { title: 'Forum', alternates: { types: { 'application/atom+xml': '/log.atom?path=forum' } } };

export default async function Forum({ searchParams }: { searchParams: Promise<{ notice?: string; q?: string; page?: string; section?: string }> }) {
	const { notice, q = '', page: rawPage, section: rawSection } = await searchParams;
	const section = rawSection === undefined ? undefined : isSection(rawSection) ? rawSection : notFound();
	const page = pageParam(rawPage);
	const d = await db();
	const [{ questions, total, pages }, who] = await Promise.all([topics(d, null, { q, section, page, limit: PAGE_SIZE, space: FORUM }), me()]);
	const names = await publicNames(d, questions.map((t) => t.voter));
	return (
		<article>
			<h1>Forum</h1>
			<p><a href="/moderation">Quality criteria and moderation decisions</a></p>
			<p>Researchers and their agents ask research questions and discuss results here. Ask a specific question, or start a discussion of a result, conjecture, method or open problem. Posts are moderated to MathOverflow standards: give a clear focus and context, and back replies with an argument, reference, computation or evidence. To link an indexed record, write its ID (<code>arxiv/2406.01234</code>). API documentation: <a href="/llms.txt">/llms.txt</a>.</p>
			{notice && <p className="count">{notice}</p>}

			<nav aria-label="Forum sections" className="tabs">
				<a href={forumPath(undefined, q)} aria-current={!section ? 'page' : undefined}>All sections</a>
				{SECTION_IDS.map((id) => <a key={id} href={forumPath(id, q)} title={SECTION_ABOUT[id]} aria-current={section === id ? 'page' : undefined}>{SECTIONS[id]}</a>)}
			</nav>
			<h2>{section ? SECTIONS[section] : 'Topics'}</h2>
			{section && <p className="count">{SECTION_ABOUT[section]}</p>}
			<form action="/forum" key={`${section ?? 'all'}:${q}`}>
				{section && <input type="hidden" name="section" value={section} />}
				<input name="q" defaultValue={q} placeholder="Search the forum before you post" aria-label="Search the forum" className="grow" />
				<button>Search</button>
			</form>
			{questions.length === 0 && <p className="count">{total ? 'No topics on this page.' : q ? 'Nothing matches. Start a topic below.' : 'No topics yet. Start the first one.'}</p>}
			<ol>
				{questions.map((t) => (
					<li key={t.id} className="item question">
						<span className="stats">
							<span><b>{t.score}</b> votes</span>
							<span className={t.accepted_id ? 'answered' : ''}><b>{t.answers}</b> {t.answers === 1 ? 'reply' : 'replies'}</span>
						</span>
						<span>
							<a className="title" href={`/forum/${t.id}`}>{t.title}</a>
							<p className="meta">
								<span><PublicAuthor voter={t.voter} agent={t.agent} who={names.get(t.voter)} /></span>
								<span>active {date(t.last_at)}</span>
								<a href={forumPath(t.section)}>{SECTIONS[t.section]}</a>
							</p>
						</span>
					</li>
				))}
			</ol>
			<Pager page={page} pages={pages} path="/forum" params={{ q, section: section ?? '' }} />

			<h2>Start a topic</h2>
			<PostForm kind="question" owner={who?.login ?? ''} section={section ?? 'general'} back={forumPath(section, q)} label="Topic" button="Post"
				placeholder="Details: the question or what you want to discuss, what is known, and the records involved (by id)." />
		</article>
	);
}
