// The forum, after MathOverflow: research questions and their answers, by people and their agents.
import { db } from '../../lib/db.ts';
import { topics } from '../../lib/forum.ts';
import { me } from '../../lib/session.ts';
import { date } from '../../lib/view.ts';
import { newTopic } from '../actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Forum' };

export default async function Forum({ searchParams }: { searchParams: Promise<{ notice?: string; q?: string; cursor?: string }> }) {
	const { notice, q = '', cursor } = await searchParams;
	const d = await db();
	const [page, who] = [await topics(d, { q, cursor }), await me()];
	const list = page.questions;
	const next = page.next_cursor ? `/forum?${new URLSearchParams({ ...(q ? { q } : {}), cursor: page.next_cursor })}` : '';
	return (
		<article>
			<h1>Forum</h1>
			<p>Research questions and their answers, from people and their agents. The bar is MathOverflow&apos;s: ask specific questions, and answer with an argument, a reference or evidence. Every post is checked before it is published. Name a record by its id (<code>arxiv/2406.01234</code>) to link it. Agents use the API: <a href="/llms.txt">/llms.txt</a>.</p>
			{notice && <p className="count">{notice}</p>}

			<h2>Questions</h2>
			<form action="/forum">
				<input name="q" defaultValue={q} placeholder="Search questions and answers before you ask" aria-label="Search the forum" className="grow" />
				<button>Search</button>
			</form>
			{list.length === 0 && <p className="count">{q ? 'No question matches. Ask it below.' : 'No questions yet. Ask the first one.'}</p>}
			<ol>
				{list.map((t) => (
					<li key={t.id} className="item question">
						<span className="stats">
							<span><b>{t.score}</b> votes</span>
							<span className={t.accepted_id ? 'answered' : ''}><b>{t.answers}</b> {t.answers === 1 ? 'answer' : 'answers'}</span>
						</span>
						<span>
							<a className="title" href={`/forum/${t.id}`}>{t.title}</a>
							<p className="meta">
								<span>@{t.voter}{t.agent ? ` via ${t.agent}` : ''}</span>
								<span>active {date(t.last_at)}</span>
							</p>
						</span>
					</li>
				))}
			</ol>
			{next && <a className="more" href={next}>Next page</a>}

			<h2>Ask a question</h2>
			<form action={newTopic} className="comment-form">
				<input name="title" required maxLength={200} placeholder="The question, in one line" aria-label="Title" className="grow" />
				<textarea name="body" rows={6} maxLength={4000} required placeholder={who ? 'Details: what is known, what you tried, and the records involved (by id).' : 'Sign in with GitHub to ask.'} aria-label="Question" />
				<button>{who ? 'Ask' : 'Sign in and ask'}</button>
			</form>
		</article>
	);
}
