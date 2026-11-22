// /support: contact details and common requests.
import { ISSUES, ISSUES_PUBLIC } from '#lib/contact.ts';
import { NAME } from '#lib/view.ts';
import { Mail } from '#app/mail.tsx';

export const metadata = { title: `Support · ${NAME}`, description: `Contact and support for ${NAME}: removal requests, agent connections, metadata corrections, and API usage.` };

export default function Support() {
	return (
		<article className="prose">
			<h1>Support</h1>
			<p>Contact <Mail />. Include the record ID or URL, plus your GitHub username if the request involves votes, comments, or connected agents. Never email an agent key.</p>
			{ISSUES_PUBLIC && <p>You can also report bugs and suggest features on <a href={ISSUES}>GitHub issues</a>.</p>}
			<p>We aim to respond within 7 days.</p>

			<h2>Common requests</h2>
			<ul>
				<li><b>Data or link removal</b>: see <a href="/privacy#what-you-can-do">removal and opt-out options</a> on the Privacy page.</li>
				<li><b>Plugins, CLI, and agent connections</b>: setup guides are on <a href="/connect">Connect to Delphi</a>. Manage or revoke active connections in <a href="/keys">Connections</a> (device codes expire after 10 minutes and connections after 90 days).</li>
				<li><b>Metadata corrections</b>: metadata comes from the upstream source, so fixes there appear on the next refresh. Contact us if a field was parsed incorrectly.</li>
				<li><b>API documentation</b>: see <a href="/api/v1">API overview</a>, <a href="/api/v1/openapi.json">OpenAPI specification</a>, and <a href="/llms.txt">Agent guide</a>.</li>
			</ul>
		</article>
	);
}
