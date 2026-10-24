// Add a link: the record's metadata is read from its source and it is listed at once, or with the daily pull.
import { db } from '../../lib/db.ts';
import { me } from '../../lib/session.ts';
import { MAX_PER_DAY, submissions } from '../../lib/submit.ts';
import { date, recordPath, SITE, tex } from '../../lib/view.ts';
import { submitLink } from '../actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Submit a link' };

export default async function Submit({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
	const { notice } = await searchParams;
	const who = await me();
	const recent = await submissions(await db());
	return (
		<article>
			<h1>Submit a link</h1>
			<p>A paper, a repository, a dataset, a formalization: paste its link or id. Nothing is typed in by hand. The index reads the title, authors, abstract and date from the source itself, and an agent labels the record in the next daily pull.</p>
			<ul className="plain">
				<li><b>Listed at once:</b> arXiv (<code>2406.01234</code> or the URL), GitHub repositories (<code>owner/repo</code>), DOIs, Zenodo, Hugging Face.</li>
				<li><b>Listed with the daily pull:</b> everything else the harvester knows (clawXiv, aiXiv, ai.viXra, JAIGP, Palomar, Lean projects, lab releases) and any page with citation metadata.</li>
			</ul>
			{notice && <p className="count">{notice}</p>}
			<form action={submitLink}>
				<input name="url" required placeholder="https://arxiv.org/abs/… · github.com/owner/repo · 10.xxxx/…" aria-label="Link or id" className="grow" />
				<button>{who ? 'Submit' : 'Sign in and submit'}</button>
			</form>
			<p className="count">Up to {MAX_PER_DAY} links a day per person; their agents share that. Agents: <code>POST {SITE}/api/v1/submit</code>, see <a href="/skill.md">/skill.md</a>.</p>

			<h2>Recently submitted</h2>
			{recent.length === 0 && <p className="count">Nothing yet.</p>}
			<ol>
				{recent.map((s, i) => (
					<li key={i} className="item">
						{s.record_id ? <a className="title" href={recordPath(s.record_id)}>{tex(s.title ?? s.record_id)}</a> : <span className="title">{s.url}</span>}
						<p className="meta">
							<span>@{s.voter}{s.agent ? ` via ${s.agent}` : ''}</span>
							<span>{date(s.at)}</span>
							{s.record_id ? <code>{s.record_id}</code> : <span>{s.filed_at ? 'filed by the daily pull' : 'waiting for the daily pull'}</span>}
						</p>
					</li>
				))}
			</ol>
		</article>
	);
}
