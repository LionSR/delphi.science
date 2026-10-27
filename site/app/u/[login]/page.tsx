import { notFound } from 'next/navigation';
import { db } from '../../../lib/db.ts';
import { normalizeProfileLogin, profileActivity, type ProfileActivity } from '../../../lib/profile.ts';
import { ProfileView } from '../../../lib/profile-view.ts';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ login: string }>; searchParams: Promise<{ cursor?: string | string[] }> };

export async function generateMetadata({ params }: Context) {
 try { return { title: `@${normalizeProfileLogin((await params).login)} — Public activity` }; }
 catch { return {}; }
}
export default async function Profile({ params, searchParams }: Context) {
 let login: string;
 try { login = normalizeProfileLogin((await params).login); } catch { notFound(); }
 const { cursor } = await searchParams;
 let activity: ProfileActivity = { login, posts: [], next_cursor: null }, failed = false;
 try {
  if (Array.isArray(cursor)) throw new Error('Repeated cursor');
  activity = await profileActivity(await db(), login, { cursor });
 } catch { failed = true; }
 return <ProfileView activity={activity} failed={failed} />;
}
