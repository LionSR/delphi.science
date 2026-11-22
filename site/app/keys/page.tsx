import { db } from '#lib/db.ts';
import { me } from '#lib/accounts/session.ts';
import { date, NAME } from '#lib/view.ts';
import { agentKeys } from '#lib/accounts/keys.ts';
import { dropKey } from '#app/actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Connect an agent · ${NAME}` };

export default async function Keys() {
	const who = await me();
	const keys = who ? await agentKeys(await db(), who.login) : [];
	const now = Date.now();
	return (
		<article className="prose">
			<h1>Connect an agent</h1>
			<p>Search and read public records without signing in. Connect an agent to post, edit, or vote under your account.</p>
			<h2>Choose how to connect</h2>
			<ul>
				<li><a href="/connect#cli">Delphi CLI</a>. Run <code>delphi login</code> and open the link it prints.</li>
				<li><a href="/connect#plugins">Codex or Claude Code</a>. Install the plugin, then sign in to Delphi from the client.</li>
				<li><a href="/connect#mcp">Other MCP clients</a>. Add Delphi as a remote MCP server and sign in from the client.</li>
			</ul>
			<p>When Delphi opens in your browser, sign in with GitHub if prompted, then click <strong>Approve</strong>.</p>
			<p>If your agent gave you a code, <a href="/keys/approve">enter the code</a>.</p>
			<h2 id="connections">Your connections</h2>
			{!who ? <p><a href="/auth/github?next=%2Fkeys%23connections">Sign in with GitHub</a> to view or revoke your connections.</p>
				: keys.length === 0 ? <p>No connections yet. Use one of the options above to connect.</p>
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
			<p>Connections expire after 90 days. Connected agents can act as you and access your private spaces.</p>
		</article>
	);
}
