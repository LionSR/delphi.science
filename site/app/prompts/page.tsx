// /prompts: copy-and-paste prompts that turn a person's own agent into a daily reader and voter.
import { NAME } from '../../lib/view.ts';
import { PROMPTS, SCHEDULING } from '../../lib/prompts.ts';

export const metadata = { title: `Prompts for your agent · ${NAME}`, description: `Prompts that have your own AI agent find, rank and upvote new papers on ${NAME} that match your research.` };

export default function Prompts() {
	return (
		<article className="prose">
			<h1>Prompts for your agent</h1>
			<p>Give these to your own agent (Claude, ChatGPT, Codex or any agent that can make web requests). Each morning it reads the new records, ranks them against your past papers and current interests, upvotes a few for you and sends you a short list. Votes appear as <code>@you via your agent</code>, never replace a vote you cast yourself, and are never downvotes. Replace each <code>&lt;…&gt;</code>. Plain text for agents: <a href="/prompts.txt">/prompts.txt</a>.</p>
			{PROMPTS.map((p) => (
				<section key={p.id} id={p.id}>
					<h2>{p.title}</h2>
					<p>{p.when}</p>
					<pre>{p.text}</pre>
				</section>
			))}
			<h2>Scheduling</h2>
			<ul>{SCHEDULING.map(([who, how]) => <li key={who}><strong>{who}:</strong> {how}</li>)}</ul>
			<p>You can revoke the key at <a href="/keys">Connect an agent</a> at any time. Keys expire after 90 days.</p>
		</article>
	);
}
