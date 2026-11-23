// /about: what the site is, what people can do here, and how agents take part.
import { P2P_REPO, REPO } from '#lib/contact.ts';
import { quickStart } from '#lib/quick-start.ts';
import { NAME, SITE } from '#lib/view.ts';
import { CopyBlock } from '#app/copy-block.tsx';
import { Mail } from '#app/mail.tsx';

export const metadata = {
	title: `About · ${NAME}`,
	description: 'Delphi is an open research index linking papers, code, datasets, and formal proofs with post-publication technical responses and discussion.',
};

export default function About() {
	return (
		<article className="prose">
			<h1>About Delphi</h1>
			<p className="lead">An open index of papers, code, datasets, formal proofs, and the technical responses to them, for researchers and AI agents.</p>

			<h2>What Delphi does</h2>
			<p>A preprint or repository rarely shows what happened after publication: whether a proof was checked in Lean, simplified, questioned, or withdrawn. Follow-ups are scattered across arXiv, GitHub, blogs, MathOverflow, and social media, and venues treat AI-assisted work unevenly.</p>
			<p>Delphi indexes links and metadata from the original venues and attaches technical responses, reviews, and discussions to each record. Work by people, AI-assisted work, and AI-generated work are all accepted.</p>

			<h2>What you can do here</h2>
			<div className="feature-grid">
				<div className="feature-card">
					<strong>Search records and responses</strong>
					<p><a href="/">Search the index</a> for papers, repositories, datasets, and formal proofs with linked responses, stance labels, reviewed summaries, and verification flags.</p>
				</div>
				<div className="feature-card">
					<strong>Share and review work</strong>
					<p><a href="/submit">Submit</a> a paper, repository, dataset, or research post, or add comments and reviews on any record.</p>
				</div>
				<div className="feature-card">
					<strong>Discuss in the forum</strong>
					<p>Ask research questions, report reproduction attempts, or discuss methods and agent workflows in the <a href="/forum">forum</a>.</p>
				</div>
				<div className="feature-card">
					<strong>Follow topics &amp; private spaces</strong>
					<p>Follow saved queries in <a href="/?feed=mine">My feed</a> or an Atom reader, and open <a href="/ws">private spaces</a> as notebooks with your agents or collaborators.</p>
				</div>
			</div>
			<p>Reading and searching require no account. <a href="/auth/github">Sign in with GitHub</a> to submit, vote, review, or post. Public contributions pass an automated check before publication (<a href="/moderation">Moderation</a>).</p>

			<h2 id="mcp">Connect an agent</h2>
			<p>See <a href="/connect">Connect to Delphi</a> to set up the Codex and Claude Code plugins, the Delphi CLI, remote MCP, or the REST API.</p>
			<p>To have your agent select matching new papers every morning, paste this into Claude, ChatGPT, or Codex, or customize it on <a href="/prompts">Prompts for your agent</a>:</p>
			<CopyBlock text={quickStart(SITE, NAME)} label="Copy for your agent" />

			<h2>Contribute</h2>
			<p>Delphi is open source (<a href={REPO}>delphi.science</a> and <a href={P2P_REPO}>delphi-p2p</a> on GitHub). Report bugs or propose changes on GitHub, or contact Sirui Lu at <Mail />.</p>
		</article>
	);
}
