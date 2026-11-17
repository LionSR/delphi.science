import { db } from '#lib/db.ts';
import { signedIn } from '#lib/accounts/session.ts';
import { subscriptions } from '#lib/accounts/subscriptions.ts';
import { SubscriptionForm } from './subscription-form.tsx';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your subscriptions · Delphi', robots: { index: false, follow: false } };

export default async function Subscriptions() {
	const who = await signedIn('/subscriptions');
	return <article>
		<h1>Your category subscriptions</h1>
		<p>Choose multiple arXiv categories for your personal home feed. Your selections are private to @{who.login} and saved across visits.</p>
		<p className="count">Matches any selected category, including imported arXiv primary and cross-listed categories. Other sources match by their indexed subject and division, as in <code>cat:</code> search. Delphi indexes selected sources; some categories may have no records yet.</p>
		<SubscriptionForm login={who.login} initial={await subscriptions(await db(), who)} />
		<p><a href="/?feed=personal">My feed</a> · <a href="/?feed=global">Global feed</a></p>
	</article>;
}
