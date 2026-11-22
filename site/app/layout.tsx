import Script from 'next/script';
import type { ReactNode } from 'react';
import { AccountNavigation } from '#lib/accounts/navigation.ts';
import { me } from '#lib/accounts/session.ts';
import { canReadUsage } from '#lib/api/usage-admin.ts';
import { DESCRIPTION, NAME, SITE } from '#lib/view.ts';
import { signOut } from './actions.ts';
import { PageViews } from './analytics.tsx';
import { Logo } from './logo.tsx';
import './globals.css';

export const metadata = {
	metadataBase: new URL(SITE),
	title: NAME,
	description: DESCRIPTION,
};

// Titles and abstracts use inline TeX ($…$); GitHub's $`…`$ is rewritten to $…$ before rendering.
const MATHJAX = `window.MathJax = {
 loader: { load: ['ui/safe'] },
 tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], processEscapes: true },
 options: { ignoreHtmlClass: 'tex2jax_ignore|mathjax_ignore', safeOptions: {
  allow: { URLs: 'safe', classes: 'none', cssIDs: 'none', styles: 'none' },
  safeProtocols: { http: true, https: true, file: false, javascript: false, data: false }
 } }
};`;

export default async function Layout({ children }: { children: ReactNode }) {
	const who = await me();
	return (
		<html lang="en">
			<head>
				<link rel="alternate" type="application/json" href="/api/v1" />
				<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt" />
			</head>
			<body>
				<main>
					<header>
						<a href="/" className="name"><Logo />{NAME}</a>
						<nav>
							<a href="/about">About</a>
							<a href="/submit">Submit</a>
							<a href="/forum">Forum</a>
							{who && <a href="/ws">Spaces</a>}
							<a href="/connect">Connect</a>
							{who ? (
								<form action={signOut}>
									<AccountNavigation person={who} />
								</form>
							) : <a href="/auth/github">Sign in with GitHub</a>}
						</nav>
					</header>
					{children}
					<footer>
						<a href="/moderation">Moderation</a>
						<a href="/privacy">Privacy</a>
						<a href="/terms">Terms</a>
						<a href="/support">Support</a>
						{canReadUsage(who) && <a href="/stats">Usage</a>}
						<a href="/api/v1">API</a>
						<a href="/llms.txt">Agent guide</a>
						<a href="/prompts">Agent prompts</a>
					</footer>
				</main>
				{process.env.ORI_WEB_ANALYTICS_ENABLED === 'true' && process.env.VERCEL_ENV === 'production' && <PageViews />}
				<Script id="mathjax-config" strategy="beforeInteractive">{MATHJAX}</Script>
				<Script src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js" strategy="afterInteractive" />
			</body>
		</html>
	);
}
