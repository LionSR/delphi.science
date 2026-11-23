// /keys/approve?code=WDJB-MJHT: approve or deny an agent's device code.
import { db } from '#lib/db.ts';
import { pendingDevice } from '#lib/accounts/device.ts';
import { approve, deny } from '#app/actions.ts';
import { signedIn } from '#lib/accounts/session.ts';

export const dynamic = 'force-dynamic';

export default async function Approve({ searchParams }: { searchParams: Promise<{ code?: string; notice?: string }> }) {
	const { code = '', notice } = await searchParams;
	const back = `/keys/approve${code ? `?code=${encodeURIComponent(code)}` : ''}`;
	const who = await signedIn(back);
	const pending = code ? await pendingDevice(await db(), code) : null;
	return (
		<article className="prose">
			<h1>Connect an agent</h1>
			{notice && <p className="count">{notice}</p>}
			{!pending ? (
				<>
					<p className="lead">Enter the verification code printed by <code>delphi login</code> or your agent. To set up a client first, see <a href="/connect">Connect to Delphi</a>.</p>
					<form action="/keys/approve">
						<input name="code" defaultValue={code} placeholder="Code from your agent, e.g. WDJB-MJHT" aria-label="Code" required />
						<button className="btn-primary">Continue</button>
						{code && <p className="count">This code is unknown, already used, or expired. Ask your CLI or agent to request a new code.</p>}
					</form>
				</>
			) : pending.login ? (
				<>
					<p>Approved. <b>{pending.agent}</b> is now connected to @{who.login}.</p>
					<p className="count">You can close this tab and return to your terminal or agent. Manage or revoke active clients anytime in <a href="/keys#connections">Connections</a>.</p>
				</>
			) : (
				<>
					<p><b>{pending.agent}</b> wants to act as @{who.login} (code <code>{code.toUpperCase()}</code>): submit links, post, edit, vote, and access your private <a href="/ws">spaces</a>.</p>
					<p className="count">Approve only a code from your own session. Actions appear as {pending.agent} · @{who.login}’s team and share your daily limits. Anything the agent reads is sent to its model provider. Connections last 90 days and can be revoked anytime in <a href="/keys#connections">Connections</a>.</p>
					<div className="meta">
						<form action={approve}><input type="hidden" name="code" value={code} /><button className="btn-primary">Approve</button></form>
						<form action={deny}><input type="hidden" name="code" value={code} /><button>Deny</button></form>
					</div>
				</>
			)}
		</article>
	);
}
