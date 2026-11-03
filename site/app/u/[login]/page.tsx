import { notFound } from 'next/navigation';
import { db } from '../../../lib/db.ts';
import { normalizeProfileLogin, profile, TABS, type Profile, type Tab } from '../../../lib/profile.ts';
import { ProfileView } from '../../../lib/profile-view.ts';
import { displayNames, type PublicName } from '../../../lib/votes.ts';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ login: string }>; searchParams: Promise<{ cursor?: string | string[]; tab?: string | string[] }> };

export async function generateMetadata({ params }: Context) {
	try {
		const login = normalizeProfileLogin((await params).login);
		const name = (await displayNames(await db(), [login])).get(login)?.name;
		return { title: `${name ? `${name} (@${login})` : `@${login}`} — Public activity` };
	} catch {
		return {};
	}
}

export default async function Profile({ params, searchParams }: Context) {
	let login: string;
	try {
		login = normalizeProfileLogin((await params).login);
	} catch {
		notFound();
	}
	const { cursor, tab: rawTab } = await searchParams;
	const tab: Tab = (TABS as readonly string[]).includes(rawTab as string) ? rawTab as Tab : 'all';
	let page: Profile | null = null;
	let who: PublicName | undefined;
	try {
		who = (await displayNames(await db(), [login])).get(login);
	} catch { /* names are optional */ }
	try {
		if (Array.isArray(cursor)) throw new Error('Repeated cursor');
		page = await profile(await db(), login, { tab, cursor });
	} catch {
		page = null;
	}
	return <ProfileView login={login} tab={tab} page={page} who={who} />;
}
