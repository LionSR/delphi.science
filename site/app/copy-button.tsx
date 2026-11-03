'use client';
// Copies the text of the <pre> just before it, so the text never crosses into the client bundle.
import { useEffect, useState } from 'react';

export function CopyButton({ label = 'Copy' }: { label?: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(t);
	}, [copied]);
	return <button type="button" onClick={async (e) => {
		await navigator.clipboard.writeText(e.currentTarget.previousElementSibling?.textContent ?? '');
		setCopied(true);
	}}>{copied ? 'Copied' : label}</button>;
}
