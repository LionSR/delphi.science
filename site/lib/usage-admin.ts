// Only explicitly configured GitHub accounts may read metrics. Empty configuration fails closed.
import type { Voter } from './votes.ts';

export function canReadUsage(who: Voter | null | undefined, configured = process.env.ORI_STATS_ADMINS ?? '') {
	const admins = configured.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
	return !!who && admins.includes(who.login.toLowerCase());
}
