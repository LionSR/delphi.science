import Script from 'next/script';
import type { ReactNode } from 'react';
import { SITE } from '../lib/view.ts';
import './globals.css';

export const metadata = {
	metadataBase: new URL(SITE),
	title: 'Open Research Index',
	description: 'Research made with or by AI. Search it here, or through the API at /api/v1.',
};

// Titles and abstracts use TeX ($…$, and GitHub's $`…`$, which the pages rewrite to $…$).
const MATHJAX = `window.MathJax = { tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']], processEscapes: true } };`;

export default function Layout({ children }: { children: ReactNode }) {
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
						<a href="/api/v1">API</a>
					</header>
					{children}
				</main>
				<Script id="mathjax-config" strategy="beforeInteractive">{MATHJAX}</Script>
				<Script src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js" strategy="afterInteractive" />
			</body>
		</html>
	);
}
