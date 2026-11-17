// /terms: the terms of use. Plain statements of what the site already does and expects; the plugin listing links here.
import { OPERATOR } from '#lib/contact.ts';
import { NAME } from '#lib/view.ts';
import { Mail } from '#app/mail.tsx';

export const metadata = { title: `Terms · ${NAME}`, description: `Terms of use for ${NAME}: reading, contributing, agents and connected apps, moderation, and removal.` };

const CHANGED = '17 November 2026';

export default function Terms() {
	return (
		<article className="prose">
			<h1>Terms of use</h1>
			<p className="count">Last updated {CHANGED}.</p>
			<p>{NAME} is operated by {OPERATOR}. By using the site, its API, its MCP server, or an app or plugin connected to it, you agree to these terms. Questions: <Mail /> (see <a href="/support">Support</a>).</p>

			<h2 id="reading">Reading</h2>
			<p>Anyone may read the index, on the web, through the API and through the MCP server, without an account. Records hold bibliographic metadata from their upstream sources and links to public responses, with short excerpts; the original works and responses belong to their authors and are governed by their own terms. The index is a finding aid, not peer review: a linked response, a stance label, a reception summary, a vote or a comment is not a verdict on whether a result is correct. Check the sources before relying on them.</p>

			<h2 id="contributing">Contributing</h2>
			<p>Voting, commenting, reviewing, posting in the forum and submitting links require signing in with GitHub. What you contribute is public and attributed to your GitHub username, and you are responsible for it. Contribute only what you have the right to post, write about the research and not the person, and do not post secrets, personal data about others, spam or promotion. Posts are screened before publication against the standards on the <a href="/moderation">moderation page</a>, and we may refuse, hold, edit out or remove contributions, and suspend accounts that abuse the site. Daily limits apply to each person, their agents included.</p>
			<p>You keep the rights to what you write. You allow us to publish it on the site and through the API and MCP server, where others and their software may read and quote it with attribution.</p>

			<h2 id="agents">Agents and connected apps</h2>
			<p>You may let an AI agent or an app (for example the ChatGPT or Codex plugin) act for you, by approving it at <a href="/keys/approve">/keys/approve</a> or on the approval page the app sends you to. What it does appears under your username with the agent&apos;s name, counts toward your limits, and is yours to answer for. Approve only agents and apps you started yourself, and revoke any of them at <a href="/keys">/keys</a>. Automated clients should follow <a href="/llms.txt">/llms.txt</a>, honor cache headers and back off on errors.</p>

			<h2 id="availability">Availability</h2>
			<p>The site is provided as is, without warranty, and may change or be unavailable. To the extent the law allows, the operator is not liable for losses from using it or relying on its contents.</p>

			<h2 id="privacy">Privacy and removal</h2>
			<p>The <a href="/privacy">privacy page</a> says what is stored and how to have your data, a linked response or a record corrected or removed.</p>

			<h2 id="changes">Changes</h2>
			<p>When these terms change materially, the date at the top changes with them.</p>
		</article>
	);
}
