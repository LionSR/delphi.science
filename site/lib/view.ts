// Small helpers the two pages share.
export const tex = (s: unknown) => String(s ?? '').replace(/\$`([^`]+)`\$/g, (_, m) => `$${m}$`);
export const date = (iso: unknown) =>
	typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso)
		? new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 10)))
		: '';
export const recordPath = (id: unknown) => `/r/${encodeURIComponent(String(id))}`;
export const tally = (r: Record<string, unknown>) => {
	const parts = [`score ${r.score ?? 0}`];
	if (r.reviews) parts.push(`${r.reviews} reviews`);
	if (r.comments) parts.push(`${r.comments} comments`);
	if (r.mentions) parts.push(`mentioned by ${r.mentions}`);
	return parts.join(' · ');
};
