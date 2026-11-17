'use client';

import { useActionState, useState } from 'react';
import type { SubscriptionState } from '#lib/accounts/subscriptions.ts';
import { SUBSCRIPTION_CATEGORIES } from '#lib/records/subscription-categories.ts';
import { divisionOf, DIVISIONS } from '#lib/records/taxonomy.ts';
import { saveCategorySubscriptions } from '#app/actions.ts';

export function SubscriptionForm({ login, initial }: { login: string; initial: string[] }) {
	const [selected, setSelected] = useState(initial);
	const [filter, setFilter] = useState('');
	const [state, action, pending] = useActionState(saveCategorySubscriptions, { saved: false, message: '' } as SubscriptionState);
	const options = Object.entries(SUBSCRIPTION_CATEGORIES);
	// React actions reset the native form on completion, including refused saves. Keep the controlled choices visible.
	return <form action={action} onReset={(event) => event.preventDefault()} className="subscription-form">
		<input type="hidden" name="login" value={login} />
		{selected.map((code) => <input key={code} type="hidden" name="category" value={code} />)}
		<fieldset disabled={pending}>
			<legend>Categories ({selected.length} selected)</legend>
			<label className="category-filter">Find a category
				<input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. quant-ph or machine learning" />
			</label>
			{selected.length > 0 && <div className="selected-categories" aria-label="Selected categories">
				{selected.map((code) => <button key={code} type="button" aria-label={`Remove ${code}`} onClick={() => setSelected(selected.filter((c) => c !== code))}>{code} ×</button>)}
				<button type="button" onClick={() => setSelected([])}>Clear all</button>
			</div>}
			<div className="category-options">
				{DIVISIONS.filter((d) => d.key !== 'other').map((d) => {
					const matches = options.filter(([code, name]) => divisionOf(code) === d.key && `${code} ${name}`.toLowerCase().includes(filter.toLowerCase()));
					return matches.length > 0 && <fieldset key={d.key}>
						<legend>{d.name}</legend>
						{matches.map(([code, name]) => <label key={code}>
							<input type="checkbox" checked={selected.includes(code)} onChange={(e) => setSelected(e.target.checked ? [...selected, code] : selected.filter((c) => c !== code))} />
							<span><code>{code}</code> — {name}</span>
						</label>)}
					</fieldset>;
				})}
				{!options.some(([code, name]) => `${code} ${name}`.toLowerCase().includes(filter.toLowerCase())) && <p>No categories match this filter. Your selected categories are kept.</p>}
			</div>
			<button>{pending ? 'Saving…' : 'Save subscriptions'}</button>
		</fieldset>
		<div aria-live="polite" role="status">
			{state.message && <p>{state.message}</p>}
			{state.signIn && <a href="/auth/github?next=/subscriptions" target="_blank" rel="noopener">Sign in in a new tab</a>}
			{state.saved && <a href="/?feed=personal">View my feed</a>}
		</div>
	</form>;
}
