'use client';
// Fills in the quick-start message from a few answers, with a Copy button. Nothing is sent anywhere.
import { useEffect, useState } from 'react';
import { DEFAULT_ANSWERS, quickStart, type Answers } from '#lib/quick-start.ts';
import { CopyBlock } from '#app/copy-block.tsx';

export function QuickStart({ site, name }: { site: string; name: string }) {
	const [f, setF] = useState(DEFAULT_ANSWERS);
	// The browser's time zone is known only after hydration.
	useEffect(() => setF((f) => f.time ? f : { ...f, time: `08:00 ${Intl.DateTimeFormat().resolvedOptions().timeZone}` }), []);
	const set = (k: Exclude<keyof Answers, 'votes'>) => (e: { target: { value: string } }) => { const v = e.target.value; setF((f) => ({ ...f, [k]: v })); };
	return (
		<div className="quick-start">
			<label>Your papers: arXiv author name, ORCID, Google Scholar link or a few arXiv IDs
				<input value={f.papers} onChange={set('papers')} placeholder='e.g. au:"Smith, J" or 2401.01234, 2310.05678' /></label>
			<label>What you work on now (optional)
				<textarea rows={2} value={f.interests} onChange={set('interests')} placeholder="Leave empty to infer it from your recent papers" /></label>
			<label>Topics to skip (optional)
				<input value={f.avoid} onChange={set('avoid')} /></label>
			<label>Every morning at
				<input value={f.time} onChange={set('time')} /></label>
			<label>Upvotes per day
				<select value={f.votes} onChange={(e) => { const votes = Number(e.target.value); setF((f) => ({ ...f, votes })); }}>
					{[1, 2, 3, 5].map((n) => <option key={n} value={n}>at most {n}</option>)}
					<option value={0}>none, just send me the list</option>
				</select></label>
			<CopyBlock text={quickStart(site, name, f)} label="Copy for your agent" />
		</div>
	);
}
