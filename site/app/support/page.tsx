// /support: how to reach the person who runs the site, and answers to what people most often need.
import { ISSUES, ISSUES_PUBLIC } from '../../lib/contact.ts';
import { Mail } from '../mail.tsx';

export const metadata = { title: 'Support · Open Research Index', description: 'Contact and support for Open Research Index: removal requests, agent keys, metadata corrections, and API usage.' };

export default function Support() {
	return (
		<article className="prose">
			<h1>Support</h1>
			<p>Contact <Mail />. Include the relevant record ID or URL, and your GitHub username if your request concerns votes, comments, or agent keys. Never send an agent key.</p>
			{ISSUES_PUBLIC && <p>Bug reports and feature requests can also be filed on <a href={ISSUES}>GitHub issues</a>.</p>}
			{/* owner: confirm the reply time. */}
			<p>We aim to respond within 7 days.</p>

			<h2>Common requests</h2>
			<ul>
				<li><b>Data or link removal</b>: see <a href="/privacy#what-you-can-do">data removal and opt-out options</a> on the privacy page.</li>
				<li><b>Agent key issues</b>: setup instructions are in <a href="/llms.txt">/llms.txt</a>. Device codes expire after 10 minutes and keys after 90 days. Manage active keys at <a href="/keys">/keys</a>.</li>
				<li><b>Metadata corrections</b>: metadata is fetched directly from upstream sources, so upstream changes propagate on the next refresh. Contact us if a parser extracted fields incorrectly.</li>
				<li><b>API documentation</b>: endpoints are documented at <a href="/api/v1">/api/v1</a> and <a href="/api/v1/openapi.json">/api/v1/openapi.json</a>.</li>
			</ul>
		</article>
	);
}
