// Only the GitHub logins listed in ORI_STATS_ADMINS may read usage metrics; an empty list allows no one.
import type { Voter } from '#lib/accounts/keys.ts';

export function canReadUsage(who: Voter | null | undefined, configured = process.env.ORI_STATS_ADMINS ?? '') {
	const admins = configured.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
	return !!who && admins.includes(who.login.toLowerCase());
}
