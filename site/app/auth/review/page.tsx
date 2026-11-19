// /auth/review: password sign-in for the plugin reviewers' demo account (lib/accounts/review.ts). Not found unless the
// owner has configured that account.
import { notFound } from 'next/navigation';
import { reviewSignIn } from '#app/actions.ts';
import { reviewLogin } from '#lib/accounts/review.ts';
import { safeNext } from '#lib/accounts/session.ts';
import { NAME } from '#lib/view.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Reviewer sign-in · ${NAME}`, robots: { index: false } };

export default async function Review({ searchParams }: { searchParams: Promise<{ next?: string; notice?: string }> }) {
	if (!reviewLogin()) notFound();
	const { next, notice } = await searchParams;
	return (
		<article>
			<h1>Reviewer sign-in</h1>
			<p className="count">For plugin reviewers, with the demo account from the submission. Everyone else signs in <a href={`/auth/github?next=${encodeURIComponent(safeNext(next))}`}>with GitHub</a>.</p>
			{notice && <p className="count">{notice}</p>}
			<form action={reviewSignIn}>
				<input type="hidden" name="next" value={safeNext(next)} />
				<input name="login" placeholder="Login" aria-label="Login" autoComplete="username" required />
				<input name="password" type="password" placeholder="Password" aria-label="Password" autoComplete="current-password" required />
				<button>Sign in</button>
			</form>
		</article>
	);
}
