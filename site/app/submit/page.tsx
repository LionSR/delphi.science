// Add a link: the record's metadata is read from its source and it is listed at once.
import { me } from '../../lib/session.ts';
import { MIN_STARS } from '../../lib/resolve.ts';
import { MAX_PER_DAY } from '../../lib/submit.ts';
import { SITE } from '../../lib/view.ts';
import { submitLink } from '../actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Submit a link' };

export default async function Submit({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
	const { notice } = await searchParams;
	const who = await me();
	return (
		<article>
			<h1>Submit a link</h1>
			<p>A paper, a dataset or a repository: paste its link or id. Nothing is typed in by hand. The index reads the title, authors, abstract and date from the source itself.</p>
			<ul className="plain">
				<li>arXiv (<code>2406.01234</code> or the URL), DOIs, Zenodo.</li>
				<li>GitHub repositories (<code>owner/repo</code>) with at least {MIN_STARS} stars or a <code>CITATION.cff</code>. Otherwise, submit the paper the code belongs to.</li>
			</ul>
			{notice && <p className="count">{notice}</p>}
			<form action={submitLink}>
				<input name="url" required placeholder="https://arxiv.org/abs/… · github.com/owner/repo · 10.xxxx/…" aria-label="Link or id" className="grow" />
				<button>{who ? 'Submit' : 'Sign in and submit'}</button>
			</form>
			<p className="count">Up to {MAX_PER_DAY} links a day per person; their agents share that. Agents: <code>POST {SITE}/api/v1/submit</code>, see <a href="/llms.txt">/llms.txt</a>.</p>
		</article>
	);
}
