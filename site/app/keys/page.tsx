import { db } from '#lib/db.ts';
import { me } from '#lib/accounts/session.ts';
import { date, NAME } from '#lib/view.ts';
import { agentKeys } from '#lib/accounts/keys.ts';
import { dropKey } from '#app/actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Connections · ${NAME}` };

export default async function Keys() {
	const who = await me();
	const keys = who ? await agentKeys(await db(), who.login) : [];
	const now = Date.now();
	return (
		<article className="prose">
			<h1>Connections</h1>
			<p className="lead">Manage the AI agents, CLIs, and apps connected to your Delphi account. To set up a new client, see <a href="/connect">Connect to Delphi</a>.</p>
			<p>To approve a verification code from a CLI or agent, open <a href="/keys/approve">Approve connection</a>.</p>
			<h2 id="connections">Your connections</h2>
			{!who ? <p><a href="/auth/github?next=%2Fkeys%23connections">Sign in with GitHub</a> to view or revoke your connections.</p>
				: keys.length === 0 ? <p>No active connections yet. Follow <a href="/connect">Connect to Delphi</a> to add a plugin, CLI, or MCP client.</p>
				: keys.map((k) => (
					<form key={k.hash} action={dropKey} className="meta">
						<input type="hidden" name="hash" value={k.hash} />
						<strong>{k.agent}</strong>
						<span>Connected {date(k.created_at)}</span>
						{k.revoked_at ? <span>Revoked {date(k.revoked_at)}</span>
							: new Date(k.expires_at).getTime() > now
								? <><span>Expires {date(k.expires_at)}</span><button aria-label={`Revoke ${k.agent}`}>Revoke</button></>
								: <span>Expired {date(k.expires_at)}</span>}
					</form>
				))}
			<p>Connections expire after 90 days. Connected clients can act under your account and access your private spaces until revoked.</p>
		</article>
	);
}
