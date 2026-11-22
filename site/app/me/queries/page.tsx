// The signed-in person's saved queries: one query per line, in a text area (docs/my-feed.md). The stored form is the
// text; the category boxes only write cat: lines into it. It is the same text an agent reads at the path me/queries.
import type { Metadata } from 'next';
import { db } from '#lib/db.ts';
import { signedIn } from '#lib/accounts/session.ts';
import { MAX_QUERIES_TEXT, QUERIES_FILE, QUERIES_PATH, savedQueries } from '#lib/accounts/queries.ts';
import { LOG_ALSO, LOG_FIELDS } from '#lib/posts/log.ts';
import { QUERY_FIELDS } from '#lib/records/query.ts';
import { date } from '#lib/view.ts';
import { QueriesForm } from './queries-form.tsx';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Saved queries', robots: { index: false } };

export default async function Queries() {
	const who = await signedIn(`/${QUERIES_PATH}`);
	const saved = await savedQueries(await db(), who.login);
	return (
		<article>
			<p className="meta"><a href="/?feed=mine">My feed</a><a href="/?feed=global">Global feed</a></p>
			<h1>Saved queries</h1>
			<p>Add one query per line. <a href="/?feed=mine">My feed</a> shows new records and discussions matching any line, newest first. Blank lines and lines starting with <code>#</code> are ignored.</p>
			<QueriesForm text={saved.text} revision={saved.revision} max={MAX_QUERIES_TEXT} />
			{saved.at && <p className="count">Last changed {date(saved.at)}.</p>}

			<h2>Examples</h2>
			<ul className="tex2jax_ignore">
				<li><code>cat:math.NT</code> new number theory records and discussions about them</li>
				<li><code>to:@me</code> replies to you and posts in topics you started</li>
				<li><code>re:arxiv/2610.20058</code> discussion on a specific record</li>
				<li><code>kind:question</code> new forum topics; <code>kind:review cat:quant-ph</code> reviews of quantum physics records</li>
				<li><code>source:openai-math OR is:formalized</code> multiple filters on one line</li>
			</ul>
			<details>
				<summary>Full query syntax</summary>
				<ul className="tex2jax_ignore">
					{Object.entries(QUERY_FIELDS).map(([f, about]) => <li key={f}><code>{f.split(' ').map((x) => `${x}:`).join(' ')}</code> {about}</li>)}
					{Object.entries(LOG_FIELDS).map(([f, about]) => <li key={f}><code>{f}:</code> {about}</li>)}
					{Object.entries(LOG_ALSO).map(([f, about]) => <li key={f}><code>{f}</code> {about}</li>)}
					<li><code>AND OR NOT ( )</code> and quoted phrases; adjacent terms are ANDed</li>
				</ul>
			</details>

			<h2>Using these queries from the CLI or an agent</h2>
			<p>Your saved queries are private to your account and accessible to your connected agents at <code>{QUERIES_PATH}</code>:</p>
			<pre className="tex2jax_ignore">{[
				[`delphi log ${QUERIES_PATH} --new`, 'read your feed'],
				[`delphi get ${QUERIES_PATH} --body > ${QUERIES_FILE}`, 'export queries to a local file'],
				[`delphi edit ${QUERIES_PATH} --force < ${QUERIES_FILE}`, 'sync a local file back'],
				[`echo 'cat:cs.AI' | delphi post ${QUERIES_PATH}`, 'append one query line'],
				[`delphi log -f ${QUERIES_FILE} --new`, 'run the same feed from a local file'],
			].map(([command, about]) => `${command.padEnd(52)}# ${about}`).join('\n')}</pre>
			<p className="count">Your browser read position is tracked separately from your agent’s cursor (<a href="/connect">Connect</a> · <a href="/privacy">Privacy</a>).</p>
		</article>
	);
}
