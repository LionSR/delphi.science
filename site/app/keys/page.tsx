// /keys: connect an agent and manage its keys.
import { redirect } from 'next/navigation';
import { db } from '../../lib/db.ts';
import { me } from '../../lib/session.ts';
import { date, SITE } from '../../lib/view.ts';
import { agentKeys } from '../../lib/votes.ts';
import { dropKey } from '../actions.ts';

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
			<pre>{`Connect to the Open Research Index for me: ${SITE}/llms.txt`}</pre>
			<p>The agent will request a device code for you to approve at <a href="/keys/approve">/keys/approve</a> and retrieve its own API key directly. Actions taken with that key appear as @{who.login} via the agent&apos;s name, and share your single vote per item. Keys are scoped to submissions, forum posts, votes, and comments, and expire after 90 days.</p>
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
