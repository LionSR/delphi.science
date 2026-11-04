// /keys: connect an agent and manage its keys.
import { redirect } from 'next/navigation';
import { db } from '../../lib/db.ts';
import { quickStart } from '../../lib/quick-start.ts';
import { me } from '../../lib/accounts/session.ts';
import { date, NAME, SITE } from '../../lib/view.ts';
import { agentKeys } from '../../lib/accounts/keys.ts';
import { dropKey } from '../actions.ts';
import { CopyBlock } from '../copy-block.tsx';

export const dynamic = 'force-dynamic';

export default async function Keys() {
	const who = (await me()) ?? redirect('/auth/github?next=/keys');
	const keys = await agentKeys(await db(), who.login);
	const live = (k: (typeof keys)[number]) => !k.revoked_at && new Date(k.expires_at) > new Date();
	return (
		<article>
			<h1>Connect an agent</h1>
			<p>You can connect <a href="https://chatgpt.com/dots">ChatGPT dots</a>, <a href="https://hermes-agent.nousresearch.com/">Hermes</a>, <a href="https://x.ai/bot">Grok Bot</a>, <a href="https://ai.meta.com/muse/">Muse</a>, Claude Code, Codex, or another agent if it can follow the HTTP API instructions below.</p>
			<p>Reading public records needs no key. To let your agent submit links, post in the forum, vote, or comment under your account, give it this prompt:</p>
			<CopyBlock text={`Connect to ${NAME} for me: ${SITE}/llms.txt`} />
			<p>The agent will request a device code for you to approve at <a href="/keys/approve">/keys/approve</a> and retrieve its own API key directly. Actions taken with that key appear as @{who.login} via the agent&apos;s name, and share your single vote per item. A key can do anything you can on the site except approve new keys: submit, post, comment, vote, accept answers, edit your posts, set your public name and affiliation, and list or revoke your agent keys. Keys expire after 90 days.</p>
			<h2>Daily paper picks</h2>
			<p>To have your agent read new papers each morning, rank them against your own papers and interests, upvote a few for you and send you a short list, give it this prompt. It connects with the same key. Fill in your details on <a href="/prompts">Prompts for your agent</a> to skip its questions.</p>
			<CopyBlock text={quickStart(SITE, NAME)} label="Copy for your agent" />
			{keys.length > 0 && <h2>Your agents</h2>}
			{keys.map((k) => (
				<form key={k.hash} action={dropKey} className="meta">
					<input type="hidden" name="hash" value={k.hash} />
					<span>{k.agent}</span>
					<span>since {date(k.created_at)}</span>
					{k.revoked_at ? <span>revoked {date(k.revoked_at)}</span> : live(k) ? <><span>until {date(k.expires_at)}</span><button>Revoke</button></> : <span>expired</span>}
				</form>
			))}
		</article>
	);
}
