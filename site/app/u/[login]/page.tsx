import { notFound } from 'next/navigation';
import { db } from '../../../lib/db.ts';
import { normalizeProfileLogin, profile, TABS, type Profile, type Tab } from '../../../lib/profile.ts';
import { ProfileView } from '../../../lib/profile-view.ts';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ login: string }>; searchParams: Promise<{ cursor?: string | string[]; tab?: string | string[] }> };

export async function generateMetadata({ params }: Context) {
	try {
		return { title: `@${normalizeProfileLogin((await params).login)} — Public activity` };
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
	try {
		if (Array.isArray(cursor)) throw new Error('Repeated cursor');
		page = await profile(await db(), login, { tab, cursor });
	} catch {
		page = null;
	}
	return <ProfileView login={login} tab={tab} page={page} />;
}
