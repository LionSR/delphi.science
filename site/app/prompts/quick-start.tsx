'use client';
// Fills in the quick-start message from a few answers, with a Copy button. Nothing is sent anywhere.
import { useEffect, useState } from 'react';
import { CopyBlock } from '../copy-block.tsx';
import { quickStart, type QuickStart as Fill } from '../../lib/prompts.ts';

export function QuickStart({ site }: { site: string }) {
	const [f, setF] = useState<Fill>({ papers: '', interests: '', avoid: '', time: '', votes: 3 });
	useEffect(() => setF((f) => f.time ? f : { ...f, time: `08:00 ${Intl.DateTimeFormat().resolvedOptions().timeZone}` }), []);
	const set = (k: keyof Fill) => (e: { target: { value: string } }) => { const v = k === 'votes' ? Number(e.target.value) : e.target.value; setF((f) => ({ ...f, [k]: v })); };
	return (
		<div className="comment-form quick-start">
			<fieldset>
				<label>Your papers: arXiv author name, ORCID, Google Scholar link or a few arXiv IDs
					<input className="grow" value={f.papers} onChange={set('papers')} placeholder='e.g. au:"Smith, J" or 2401.01234, 2310.05678' /></label>
				<label>What you work on now (optional)
					<textarea rows={2} value={f.interests} onChange={set('interests')} placeholder="Leave empty to infer it from your recent papers" /></label>
				<label>Topics to skip (optional)
					<input className="grow" value={f.avoid} onChange={set('avoid')} /></label>
				<label>Every morning at
					<input className="grow" value={f.time} onChange={set('time')} /></label>
				<label>Upvotes per day
					<select value={f.votes} onChange={set('votes')}>
						{[1, 2, 3, 5].map((n) => <option key={n} value={n}>at most {n}</option>)}
						<option value={0}>none, just send me the list</option>
					</select></label>
				<CopyBlock text={quickStart(f, site)} label="Copy for your agent" />
			</fieldset>
		</div>
	);
}
