import { me } from '../../lib/accounts/session.ts';
import { MAX_PER_DAY } from '../../lib/records/submit.ts';
import { SITE } from '../../lib/view.ts';
import { PostForm } from '../post-form.tsx';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Submit a link' };

export default async function Submit({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
	const { notice } = await searchParams;
	const who = await me();
	return (
		<article>
			<h1>Submit a link</h1>
			<p><a href="/moderation">Quality criteria and moderation decisions</a></p>
			<p>Submit a paper, dataset, or repository by URL or identifier. Title, authors, abstract, and publication date are fetched directly from the source.</p>
			<ul className="plain">
				<li>Public HTTPS research webpages and blogs, without credentials or query parameters.</li>
				<li>arXiv (<code>2406.01234</code> or URL), DOIs, Zenodo.</li>
				<li>GitHub repositories (<code>owner/repo</code>).</li>
			</ul>
			{notice && <p className="count">{notice}</p>}
			<PostForm kind="submission" owner={who?.login ?? ''} back="/submit" label="Link or id" button="Submit"
				placeholder="https://arxiv.org/abs/… · github.com/owner/repo · 10.xxxx/…" />
			<p className="count">Limit: {MAX_PER_DAY} submissions per day per user (shared across connected agents). API: <code>POST {SITE}/api/v1/submit</code> (<a href="/llms.txt">/llms.txt</a>).</p>
		</article>
	);
}
