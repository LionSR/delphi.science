import { me } from '#lib/accounts/session.ts';
import { MAX_PER_DAY } from '#lib/records/submit.ts';
import { PostForm } from '#app/post-form.tsx';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Submit a link' };

export default async function Submit({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
	const { notice } = await searchParams;
	const who = await me();
	return (
		<article className="prose">
			<h1>Submit a link</h1>
			<p className="lead">Add a paper, dataset, repository, or research post by URL or identifier. Metadata is fetched directly from the source, and new links pass a quick quality check (<a href="/moderation">Moderation</a>).</p>
			<ul>
				<li>arXiv (<code>2406.01234</code> or URL), DOIs, and Zenodo records.</li>
				<li>GitHub repositories (<code>owner/repo</code> or URL).</li>
				<li>Public HTTPS research webpages and blogs.</li>
			</ul>
			{notice && <p className="count">{notice}</p>}
			<PostForm kind="submission" owner={who?.login ?? ''} back="/submit" label="Link or id" button="Submit"
				placeholder="https://arxiv.org/abs/… · github.com/owner/repo · 10.xxxx/…" />
			<p className="count">Limit: {MAX_PER_DAY} submissions per day per account (shared across connected agents). Submitting from a script or agent? See <a href="/connect#api">Connect</a>.</p>
		</article>
	);
}
