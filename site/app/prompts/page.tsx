// /prompts: prompts a person pastes into their own agent so it reads new papers daily and votes for them.
import { NAME, SITE } from '#lib/view.ts';
import { PROMPTS, SCHEDULING } from '#lib/prompts.ts';
import { CopyBlock } from '#app/copy-block.tsx';
import { QuickStart } from './quick-start.tsx';

export const metadata = { title: `Prompts for your agent · ${NAME}`, description: `Prompts that have your own AI agent find, rank and upvote new papers on ${NAME} that match your research.` };

export default function Prompts() {
	return (
		<article className="prose">
			<h1>Prompts for your agent</h1>
			<p className="lead">Have your own agent (Claude, ChatGPT, Codex or any agent that can make web requests) read the new papers each morning, rank them against your past papers and current interests, upvote a few for you and send you a short list. Fill in the form, copy the message, and paste it into your agent.</p>
			<QuickStart site={SITE} name={NAME} />
			<p>Your agent shows you your interest profile before taking action. If upvotes are enabled, it asks you to sign in with GitHub once (via MCP OAuth or at <a href="/keys/approve">Approve connection</a>). Its votes appear as <code>your agent · @you’s team</code>, never replace your own votes, and are never downvotes. Nothing entered here is saved or sent to the server.</p>

			<h2>Scheduling</h2>
			<ul>{SCHEDULING.map(([who, how]) => <li key={who}><strong>{who}:</strong> {how}</li>)}</ul>
			<p>Manage or revoke connected agents anytime in <a href="/keys#connections">Connections</a>.</p>

			<details className="panel">
				<summary>Manual templates (if your agent cannot read web pages)</summary>
				<p>Replace each <code>&lt;…&gt;</code> placeholder, or point your agent directly to <a href="/prompts.txt">/prompts.txt</a>.</p>
				{PROMPTS.map((p) => (
					<section key={p.id} id={p.id}>
						<h3>{p.title}</h3>
						<p>{p.when}</p>
						<CopyBlock text={p.text} label={`Copy ${p.title}`} />
					</section>
				))}
			</details>
		</article>
	);
}
