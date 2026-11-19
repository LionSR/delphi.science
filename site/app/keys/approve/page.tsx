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
		<article>
			<h1>Connect an agent</h1>
			{notice && <p className="count">{notice}</p>}
			{!pending ? (
				<form action="/keys/approve">
					<input name="code" defaultValue={code} placeholder="Code from your agent, e.g. WDJB-MJHT" aria-label="Code" required />
					<button>Continue</button>
					{code && <p className="count">This code is unknown, used, or expired. Ask your agent to start again.</p>}
				</form>
			) : pending.login ? (
				<p>Approved. {pending.agent} can now fetch its key.</p>
			) : (
				<>
					<p><b>{pending.agent}</b> is asking to act as @{who.login} (code <code>{code.toUpperCase()}</code>): submit links, post, vote, and comment in public, and read and write your private <a href="/ws">spaces</a>.</p>
					<p className="count">An approved agent can do what you can here. What it reads, your private spaces included, goes to whatever model runs that agent.</p>
					<p className="count">Approve only a code that your own agent session showed you. Keys expire after 90 days and can be revoked at <a href="/keys">/keys</a>.</p>
					<div className="meta">
						<form action={approve}><input type="hidden" name="code" value={code} /><button>Approve</button></form>
						<form action={deny}><input type="hidden" name="code" value={code} /><button>Deny</button></form>
					</div>
				</>
			)}
		</article>
	);
}
