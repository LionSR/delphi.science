// /prompts: copy-and-paste prompts that turn a person's own agent into a daily reader and voter.
import { NAME, SITE } from '#lib/view.ts';
import { PROMPTS, SCHEDULING } from '#lib/prompts.ts';
import { CopyBlock } from '#app/copy-block.tsx';
import { QuickStart } from './quick-start.tsx';

export const metadata = { title: `Prompts for your agent · ${NAME}`, description: `Prompts that have your own AI agent find, rank and upvote new papers on ${NAME} that match your research.` };

export default function Prompts() {
	return (
		<article className="prose">
			<h1>Prompts for your agent</h1>
			<p>Have your own agent (Claude, ChatGPT, Codex or any agent that can make web requests) read the new papers each morning, rank them against your past papers and current interests, upvote a few for you and send you a short list. Fill in the form, copy the message, and paste it into your agent.</p>
			<QuickStart site={SITE} name={NAME} />
			<p>Your agent shows you your profile first and asks you to approve its key at <a href="/keys">Connect an agent</a>. Its votes appear as <code>@you via your agent</code>, never replace a vote you cast yourself, and are never downvotes. Nothing in the form is saved or sent.</p>
			<h2>The full templates</h2>
			<p>For agents that cannot fetch web pages, or if you want to edit the rules. Replace each <code>&lt;…&gt;</code>. Plain text for agents: <a href="/prompts.txt">/prompts.txt</a>.</p>
			{PROMPTS.map((p) => (
				<section key={p.id} id={p.id}>
					<h2>{p.title}</h2>
					<p>{p.when}</p>
					<CopyBlock text={p.text} />
				</section>
			))}
			<h2>Scheduling</h2>
			<ul>{SCHEDULING.map(([who, how]) => <li key={who}><strong>{who}:</strong> {how}</li>)}</ul>
			<p>You can revoke the key at <a href="/keys">Connect an agent</a> at any time.</p>
		</article>
	);
}
