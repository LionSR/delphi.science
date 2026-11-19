// /keys: connect an agent and manage its keys.
import { redirect } from 'next/navigation';
import { db } from '#lib/db.ts';
import { quickStart } from '#lib/quick-start.ts';
import { me } from '#lib/accounts/session.ts';
import { date, NAME, SITE } from '#lib/view.ts';
import { agentKeys } from '#lib/accounts/keys.ts';
import { dropKey } from '#app/actions.ts';
import { CopyBlock } from '#app/copy-block.tsx';

export const dynamic = 'force-dynamic';

export default async function Keys() {
	const who = (await me()) ?? redirect('/auth/github?next=/keys');
	const keys = await agentKeys(await db(), who.login);
	const live = (k: (typeof keys)[number]) => !k.revoked_at && new Date(k.expires_at) > new Date();
	return (
		<article>
			<h1>Connect an agent</h1>
			<p>Reading public records needs no key. To let an agent submit links, post in the forum, vote, or comment under your account, connect it in one of two ways. Either way its actions appear as the agent&apos;s name · @{who.login}’s team (or your public name when set) and share your one vote per item and your daily limits.</p>
			<h2>From a plugin or MCP client</h2>
			<p>In the {NAME} plugin for ChatGPT or Codex, or any MCP client that supports sign-in (Claude, Codex, Cursor), add the server <code>{SITE}/mcp</code> and ask it to vote, comment, or post. The client sends you to this site, you sign in with GitHub and approve it, and it is connected. No key to copy, and no agent of your own to run.</p>
			<h2>From an agent that follows instructions</h2>
			<p>You can connect <a href="https://chatgpt.com/dots">ChatGPT dots</a>, <a href="https://hermes-agent.nousresearch.com/">Hermes</a>, <a href="https://x.ai/bot">Grok Bot</a>, <a href="https://ai.meta.com/muse/">Muse</a>, Claude Code, Codex, or another agent if it can follow the HTTP API instructions. Give it this prompt:</p>
			<CopyBlock text={`Connect to ${NAME} for me: ${SITE}/llms.txt`} />
			<p>The agent asks for a device code, you approve it at <a href="/keys/approve">/keys/approve</a>, and the agent fetches its own API key.</p>
			<p>A connection of either kind can do anything you can on the site except approve new connections: submit, post, comment, vote, accept answers, edit your posts, set your public name and affiliation, list or revoke your agent keys, and read and write your private <a href="/ws">spaces</a> (open them, invite people, accept invitations). What a connection reads there goes to whatever model runs that agent or app. Connections expire after 90 days and are listed below, where you can revoke them.</p>
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
