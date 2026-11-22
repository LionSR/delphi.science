import { notFound } from 'next/navigation';
import { db } from '#lib/db.ts';
import { connectedAgentCount } from '#lib/accounts/keys.ts';
import { MAX_AFFILIATION, MAX_NAME, ownName, publicName } from '#lib/accounts/people.ts';
import { normalizeProfileLogin, profile, TABS, type Tab } from '#lib/accounts/profile.ts';
import { ProfileView } from '#lib/accounts/profile-view.ts';
import { me } from '#lib/accounts/session.ts';
import { savePublicName } from '#app/actions.ts';
import { pageParam } from '#lib/pager.ts';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ login: string }>; searchParams: Promise<{ page?: string | string[]; tab?: string | string[]; notice?: string }> };

export async function generateMetadata({ params }: Context) {
	try {
		const login = normalizeProfileLogin((await params).login);
		const { name } = await publicName(await db(), login);
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
	const { page: rawPage, tab: rawTab, notice } = await searchParams;
	const tab: Tab = (TABS as readonly string[]).includes(rawTab as string) ? rawTab as Tab : 'all';
	const d = await db();
	// A failure to load the activity shows "temporarily unavailable" with a retry link.
	const [who, page, viewer, connectedAgents] = await Promise.all([
		publicName(d, login),
		profile(d, login, { tab, page: pageParam(rawPage) }).catch(() => null),
		me(),
		connectedAgentCount(d, login).catch(() => undefined),
	]);
	const owner = viewer?.login.toLowerCase() === login.toLowerCase();
	const own = owner ? await ownName(d, login).catch(() => null) : null;
	const editor = own ? (
		<details className="profile-edit" open={!own.name && !own.affiliation}>
			<summary>Edit name and affiliation</summary>
			{notice && <p className="count">{notice}</p>}
			<form action={savePublicName}>
				<input type="hidden" name="login" value={login} />
				<label>Name <input name="name" defaultValue={own.name} maxLength={MAX_NAME} autoComplete="name" /></label>
				<label>Affiliation <input name="affiliation" defaultValue={own.affiliation} maxLength={MAX_AFFILIATION} autoComplete="organization" placeholder="e.g. University of California San Diego" /></label>
				<button className="btn-primary">Save</button>
			</form>
			<p className="meta"><span>Shown publicly beside your username. Saving here overrides the values imported from GitHub.</span></p>
		</details>
	) : null;
	return <ProfileView login={login} tab={tab} page={page} who={who} connectedAgents={connectedAgents} owner={owner} editor={editor} />;
}
