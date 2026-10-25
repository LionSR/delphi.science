import Script from 'next/script';
import type { ReactNode } from 'react';
import { me } from '../lib/session.ts';
import { SITE } from '../lib/view.ts';
import { signOut } from './actions.ts';
import './globals.css';

export const metadata = {
	metadataBase: new URL(SITE),
	title: 'Open Research Index',
	description: 'A curated index of AI-made research and of what experts said about it: every record read from its source, pseudoscience venues refused, and expert reactions linked with author and date. Search it here, or through the API at /api/v1.',
};

// Titles and abstracts use TeX ($…$, and GitHub's $`…`$, which the pages rewrite to $…$).
const MATHJAX = `window.MathJax = { tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], processEscapes: true } };`;

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
						<a href="/" className="name">Open Research Index</a>
						<nav>
							<a href="/api/v1">API</a>
							{who ? (
								<form action={signOut}>
									<a href="/keys">@{who.login}</a> <button className="link">Sign out</button>
								</form>
							) : <a href="/auth/github">Sign in with GitHub</a>}
						</nav>
					</header>
					{children}
				</main>
				<Script id="mathjax-config" strategy="beforeInteractive">{MATHJAX}</Script>
				<Script src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js" strategy="afterInteractive" />
			</body>
		</html>
	);
}
