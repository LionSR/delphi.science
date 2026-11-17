// /oauth/authorize: the OAuth approval page for the MCP server's sign-in (lib/accounts/oauth.ts). An app such as the
// ChatGPT plugin sends its person here; they sign in with GitHub and approve or deny, and go back to the app.
import { authorizeRequest } from '#lib/accounts/oauth.ts';
import { me } from '#lib/accounts/session.ts';
import { reviewLogin } from '#lib/accounts/review.ts';
import { approveApp, denyApp } from '#app/actions.ts';
import { NAME } from '#lib/view.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Connect an app · ${NAME}`, robots: { index: false } };

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	const query = await searchParams;
	const { params, page, request } = authorizeRequest((k) => query[k]);
	// Not redirected unasked: anyone can register a client, so that would make this page an open redirector.
	if ('refuse' in request) {
		const to = new URL(request.refuse);
		return (
			<article>
				<h1>Connect an app</h1>
				<p className="count">The app&apos;s request is incomplete ({to.searchParams.get('error_description')}), so there is nothing to approve.</p>
				<p><a href={request.refuse} rel="noreferrer">Return to {to.host || to.protocol}</a></p>
			</article>
		);
	}
	if ('show' in request) return <article><h1>Connect an app</h1><p className="count">{request.show}</p></article>;
	const to = new URL(request.redirect_uri);
	const who = await me();
	if (!who) {
		// Said before anyone is sent to GitHub: which app is asking, and for what.
		const back = encodeURIComponent(page);
		return (
			<article>
				<h1>Connect an app</h1>
				<p><b>{request.client.name}</b> is asking to act for you on {NAME}: submit links, post, vote, and comment under your GitHub login. Sign in to review the request; nothing is connected until you approve it.</p>
				<p><a href={`/auth/github?next=${back}`}>Sign in with GitHub</a></p>
				{reviewLogin() && <p className="count">Reviewing the plugin? <a href={`/auth/review?next=${back}`}>Sign in with the demo account</a>.</p>}
				<p className="count">Only your public GitHub username, name and company are read (<a href="/privacy">Privacy</a>). Reading the index needs no connection.</p>
			</article>
		);
	}
	const hidden = Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
	return (
		<article>
			<h1>Connect an app</h1>
			<p><b>{request.client.name}</b> is asking to submit links, post, vote, and comment as @{who.login}. Afterwards you return to <code>{to.host || to.protocol}</code>.</p>
			<p className="count">Approve only if you started this from the app yourself. What it does appears as {request.client.name} · @{who.login}’s team and shares your one vote per item and your daily limits. The connection lasts 90 days and can be revoked at <a href="/keys">/keys</a>. Reading the index needs no connection.</p>
			<div className="meta">
				<form action={approveApp}>{hidden}<button>Approve</button></form>
				<form action={denyApp}>{hidden}<button>Deny</button></form>
			</div>
		</article>
	);
}
