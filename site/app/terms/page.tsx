// /terms: the terms of use. Plain statements of what the site does and expects; the plugin listing links here.
import { OPERATOR } from '#lib/contact.ts';
import { NAME } from '#lib/view.ts';
import { Mail } from '#app/mail.tsx';

export const metadata = { title: `Terms · ${NAME}`, description: `Terms of use for ${NAME}: reading, contributing, agents and connected apps, moderation, and removal.` };

const CHANGED = '22 November 2026';

export default function Terms() {
	return (
		<article className="prose">
			<h1>Terms of use</h1>
			<p className="count">Last updated {CHANGED}.</p>
			<p>{NAME} is operated by {OPERATOR}. By using the site, its API, its MCP server, or a connected plugin or app, you agree to these terms. Questions: <Mail /> (see <a href="/support">Support</a>).</p>

			<h2 id="reading">Reading</h2>
			<p>Anyone may read the index on the web, through the API, or through the MCP server without an account. Records hold bibliographic metadata from upstream sources and links to public commentary; original works belong to their authors under their own terms. The index is a finding aid rather than formal peer review, so check primary sources before relying on a summary, stance label, vote, or comment.</p>

			<h2 id="contributing">Contributing</h2>
			<p>Submitting links, voting, commenting, reviewing, and posting in the forum require signing in with GitHub. Public contributions are attributed to your GitHub username, and you are responsible for what you post. Contribute only material you have the right to share, focus on the research rather than the person, and do not post secrets, private personal data, spam, or promotion. Public posts are screened against our <a href="/moderation">moderation guidelines</a>, and we may decline or remove contributions or suspend accounts that abuse the site. Daily limits apply per account across you and your connected agents.</p>
			<p>You keep ownership of what you write and grant us permission to publish it on the site and through the API and MCP server, where others and their tools may read and quote it with attribution.</p>

			<h2 id="agents">Agents and connected apps</h2>
			<p>You may connect an AI agent, CLI, or plugin (such as the Codex or Claude Code plugin; see <a href="/connect">Connect to Delphi</a>) by approving it through OAuth or at <a href="/keys/approve">/keys/approve</a>. Actions taken by a connected client appear under your username with the client’s name, share your daily limits, and remain your responsibility. Approve only clients you started yourself, and revoke them anytime in <a href="/keys">Connections</a>. Automated clients should follow <a href="/llms.txt">/llms.txt</a>, honor cache headers, and back off on errors.</p>

			<h2 id="availability">Availability</h2>
			<p>The site is provided as is, without warranty, and may change or be unavailable. To the extent permitted by law, the operator is not liable for losses arising from using the site or relying on its contents.</p>

			<h2 id="privacy">Privacy and removal</h2>
			<p>See the <a href="/privacy">Privacy page</a> for what data is stored and how to request corrections or removals.</p>

			<h2 id="changes">Changes</h2>
			<p>When these terms change materially, we update the date at the top of this page.</p>
		</article>
	);
}
