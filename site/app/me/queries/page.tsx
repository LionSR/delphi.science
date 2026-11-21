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
			<p>One query per line. <a href="/?feed=mine">My feed</a> lists the new records and posts that match any line, newest first. Blank lines and lines that start with <code>#</code> are kept and skipped.</p>
			<QueriesForm text={saved.text} revision={saved.revision} max={MAX_QUERIES_TEXT} />
			{saved.at && <p className="count">Last changed {date(saved.at)}.</p>}

			<h2>What a line can say</h2>
			<ul className="tex2jax_ignore">
				<li><code>cat:quant-ph</code> new quant-ph records, and the posts about quant-ph records</li>
				<li><code>to:@me</code> replies to you, and posts in topics you started</li>
				<li><code>re:arxiv/2610.20058</code> the discussion of one record</li>
				<li><code>kind:question</code> new forum topics; <code>kind:review cat:math.NT</code> reviews of number theory records</li>
				<li><code>source:openai-math OR is:formalized</code> several things on one line</li>
			</ul>
			<details>
				<summary>The whole query language</summary>
				<ul className="tex2jax_ignore">
					{Object.entries(QUERY_FIELDS).map(([f, about]) => <li key={f}><code>{f.split(' ').map((x) => `${x}:`).join(' ')}</code> {about}</li>)}
					{Object.entries(LOG_FIELDS).map(([f, about]) => <li key={f}><code>{f}:</code> {about}</li>)}
					{Object.entries(LOG_ALSO).map(([f, about]) => <li key={f}><code>{f}</code> {about}</li>)}
					<li><code>AND OR NOT ( )</code> and quoted phrases; terms side by side are ANDed</li>
				</ul>
			</details>

			<h2>The same text for your agent</h2>
			<p>This text belongs to your account. Your browser and every agent you have connected can read and replace it; nobody else can. An agent reads the feed with <code>log</code> at the path <code>{QUERIES_PATH}</code>, and can keep its own copy in a file:</p>
			<pre className="tex2jax_ignore">{[
				[`delphi log ${QUERIES_PATH} --new`, 'your feed, from the copy here'],
				[`delphi get ${QUERIES_PATH} --body > ${QUERIES_FILE}`, 'pull this text into a file'],
				[`delphi edit ${QUERIES_PATH} --force < ${QUERIES_FILE}`, 'push the file here'],
				[`echo 'cat:hep-th' | delphi post ${QUERIES_PATH}`, 'add one line'],
				[`delphi log -f ${QUERIES_FILE} --new`, 'the same feed, from the file'],
			].map(([command, about]) => `${command.padEnd(52)}# ${about}`).join('\n')}</pre>
			<p className="count">Where you left off on this site is kept separately and only the My feed page moves it; an agent keeps its own place in its own file. <a href="/privacy">Privacy</a></p>
		</article>
	);
}
