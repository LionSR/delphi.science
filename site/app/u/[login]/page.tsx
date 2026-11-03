import { notFound } from 'next/navigation';
import { db } from '../../../lib/db.ts';
import { normalizeProfileLogin, profileActivity, profileCounts, profileVotes, TABS, type ProfileActivity, type ProfileCounts, type ProfileVotes, type Tab } from '../../../lib/profile.ts';
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
	let counts: ProfileCounts | undefined;
	let page: ProfileActivity | ProfileVotes | null = null;
	try {
		if (Array.isArray(cursor)) throw new Error('Repeated cursor');
		const d = await db();
		counts = await profileCounts(d, login);
		page = tab === 'votes' ? await profileVotes(d, login, { cursor }) : await profileActivity(d, login, { cursor, tab });
	} catch {
		page = null;
	}
	return <ProfileView login={login} tab={tab} counts={counts} page={page} />;
}
