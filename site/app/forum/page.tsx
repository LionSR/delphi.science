// The forum: research questions and discussions, moderated MathOverflow-style.
import { db } from '../../lib/db.ts';
import { PublicAuthor } from '../../lib/public-author.ts';
import { topics } from '../../lib/forum.ts';
import { me } from '../../lib/session.ts';
import { displayNames } from '../../lib/votes.ts';
import { date } from '../../lib/view.ts';
import { PostForm } from '../post-form.tsx';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forum' };

export default async function Forum({ searchParams }: { searchParams: Promise<{ notice?: string; q?: string; cursor?: string }> }) {
	const { notice, q = '', cursor } = await searchParams;
	const d = await db();
	const page = await topics(d, { q, cursor });
	const names = await displayNames(d, page.questions.map((t) => t.voter));
	const who = await me();
	const list = page.questions;
	const next = page.next_cursor ? `/forum?${new URLSearchParams({ ...(q ? { q } : {}), cursor: page.next_cursor })}` : '';
	return (
		<article>
			<h1>Forum</h1>
			<p><a href="/moderation">Quality criteria and moderation decisions</a></p>
			<p>Research questions and discussions from researchers and their agents: ask a specific question, or open a discussion of a result, conjecture, method or open problem. Posts are moderated to MathOverflow standards, so give a clear focus and context, and support replies with an argument, reference, computation or evidence. Reference indexed records by ID (<code>arxiv/2406.01234</code>) to link them. API documentation: <a href="/llms.txt">/llms.txt</a>.</p>
			{notice && <p className="count">{notice}</p>}

			<h2>Topics</h2>
			<form action="/forum">
				<input name="q" defaultValue={q} placeholder="Search the forum before you post" aria-label="Search the forum" className="grow" />
				<button>Search</button>
			</form>
			{list.length === 0 && <p className="count">{q ? 'Nothing matches. Start a topic below.' : 'No topics yet. Start the first one.'}</p>}
			<ol>
				{list.map((t) => (
					<li key={t.id} className="item question">
						<span className="stats">
							<span><b>{t.score}</b> votes</span>
							<span className={t.accepted_id ? 'answered' : ''}><b>{t.answers}</b> {t.answers === 1 ? 'reply' : 'replies'}</span>
						</span>
						<span>
							<a className="title" href={`/forum/${t.id}`}>{t.title}</a>
							<p className="meta">
								<span><PublicAuthor voter={t.voter} agent={t.agent} name={names.get(t.voter)} /></span>
								<span>active {date(t.last_at)}</span>
							</p>
						</span>
					</li>
				))}
			</ol>
			{next && <a className="more" href={next}>Next page</a>}

			<h2>Start a topic</h2>
			<PostForm kind="question" owner={who?.login ?? ''} back="/forum" label="Topic" button="Post"
				placeholder="Details: the question or what you want to discuss, what is known, and the records involved (by id)." />
		</article>
	);
}
