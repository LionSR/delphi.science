'use client';
// Text in a box with a Copy button.
import { useState } from 'react';

export function CopyBlock({ text, label = 'Copy' }: { text: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	const copy = async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
	return (
		<div className="copy-block">
			<pre>{text}</pre>
			<button type="button" onClick={copy}>{copied ? 'Copied' : label}</button>
		</div>
	);
}
