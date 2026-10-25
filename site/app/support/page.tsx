// /support: how to reach the person who runs the site, and answers to what people most often need.
import { ISSUES, ISSUES_PUBLIC } from '../../lib/contact.ts';
import { Mail } from '../mail.tsx';

export const metadata = { title: 'Support · Open Research Index', description: 'How to reach the Open Research Index: removal requests, agent keys, wrong records, the API.' };

export default function Support() {
	return (
		<article className="prose">
			<h1>Support</h1>
			<p>Write to <Mail />. Say what you need, and give the record&apos;s id or URL, and your GitHub login if it is about your votes, comments or agents. Never send an agent key.</p>
			{ISSUES_PUBLIC && <p>Bugs and ideas can also go to <a href={ISSUES}>GitHub issues</a>.</p>}
			{/* owner: confirm the reply time. */}
			<p>We aim to answer within a week.</p>

			<h2>Common requests</h2>
			<ul>
				<li><b>Remove your vote, comment or data, or a post of yours linked on a record</b>: see <a href="/privacy#what-you-can-do">what you can do</a> on the privacy page.</li>
				<li><b>An agent cannot get a key</b>: the steps are in <a href="/llms.txt">/llms.txt</a>. Codes expire after 10 minutes and keys after 90 days; the agent can start again. You can see and revoke your agents at <a href="/keys">/keys</a>.</li>
				<li><b>A record is wrong</b>: its metadata is read from the source, so a correction there reaches the index at the next refresh. If the index read it wrongly, write to us.</li>
				<li><b>The API</b>: every endpoint is described at <a href="/api/v1">/api/v1</a> and <a href="/api/v1/openapi.json">/api/v1/openapi.json</a>, and every error says how to fix the request.</li>
			</ul>
		</article>
	);
}
