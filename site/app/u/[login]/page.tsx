import { cache } from 'react';
import { notFound } from 'next/navigation';
import { db } from '#lib/db.ts';
import { fetchArxivAuthorPapers } from '#lib/accounts/arxiv-author.ts';
import { connectedAgentCount } from '#lib/accounts/keys.ts';
import { MAX_AFFILIATION, MAX_ARXIV_INPUT, MAX_BIO, MAX_NAME, MAX_URL, ownName, toPublicProfile, type OwnProfile } from '#lib/accounts/people.ts';
import { normalizeProfileLogin, profile, TABS, type Tab } from '#lib/accounts/profile.ts';
import { ProfileView, type ProfileTab } from '#lib/accounts/profile-view.ts';
import { me } from '#lib/accounts/session.ts';
import { savePublicName } from '#app/actions.ts';
import { pageParam } from '#lib/pager.ts';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ login: string }>; searchParams: Promise<{ page?: string | string[]; tab?: string | string[]; notice?: string }> };

// Read once per request: metadata, public profile header, and owner edit form all share this row.
const readProfile = cache(async (login: string) => ownName(await db(), login).catch(() => null));

export async function generateMetadata({ params }: Context) {
	try {
		const login = normalizeProfileLogin((await params).login);
		const row = await readProfile(login);
		const name = row ? toPublicProfile(row).name : '';
		return { title: `${name ? `${name} (@${login})` : `@${login}`} — Profile` };
	} catch {
		return {};
	}
}

function ProfileEditor({ login, own, notice }: { login: string; own: OwnProfile; notice?: string }) {
	const empty = ![own.name, own.affiliation, own.bio, own.url, own.arxiv_id].some(Boolean);
	return (
		<details className="profile-edit" open={Boolean(notice) || empty}>
			<summary>Edit profile</summary>
			{notice && <p className="count" role="alert">{notice}</p>}
			<form action={savePublicName}>
				<input type="hidden" name="login" value={login} />
				<div className="profile-edit-grid">
					<label>Name <input name="name" defaultValue={own.name} maxLength={MAX_NAME} autoComplete="name" /></label>
					<label>Affiliation <input name="affiliation" defaultValue={own.affiliation} maxLength={MAX_AFFILIATION} autoComplete="organization" placeholder="e.g. University of California San Diego" /></label>
					<label>Website <input name="url" defaultValue={own.url} maxLength={MAX_URL} autoComplete="url" placeholder="https://example.edu/~you" /></label>
					<label>arXiv author link or ORCID <input name="arxiv_id" defaultValue={own.arxiv_id} maxLength={MAX_ARXIV_INPUT} placeholder="arxiv.org/a/surname_i_1 or 0000-0000-0000-0000" /></label>
					<label className="full">Bio <textarea name="bio" defaultValue={own.bio} maxLength={MAX_BIO} rows={3} placeholder="Research interests, current projects, or a short note." /></label>
				</div>
				<button className="btn-primary">Save profile</button>
			</form>
			<p className="meta"><span>Shown publicly on your profile. Saving overrides name and affiliation imported from GitHub; an arXiv public author link or ORCID populates the Papers tab.</span></p>
		</details>
	);
}

export default async function Profile({ params, searchParams }: Context) {
	let login: string;
	try { login = normalizeProfileLogin((await params).login); } catch { notFound(); }
	const { page: rawPage, tab: rawTab, notice } = await searchParams;
	const tab: ProfileTab = rawTab === 'papers' ? 'papers' : (TABS as readonly string[]).includes(rawTab as string) ? rawTab as Tab : 'all';
	const d = await db();
	// A failure to load the activity shows "temporarily unavailable" with a retry link.
	const [row, page, viewer, connectedAgents] = await Promise.all([
		readProfile(login),
		profile(d, login, { tab: tab === 'papers' ? 'all' : tab, page: tab === 'papers' ? 1 : pageParam(rawPage) }).catch(() => null),
		me(),
		connectedAgentCount(d, login).catch(() => undefined),
	]);
	const who = row ? toPublicProfile(row) : undefined;
	const owner = viewer?.login.toLowerCase() === login.toLowerCase();
	const papers = tab === 'papers' && who?.arxiv_id ? await fetchArxivAuthorPapers(d, who.arxiv_id) : null;
	const editor = owner && row ? <ProfileEditor login={login} own={row} notice={notice} /> : null;
	return <ProfileView login={login} tab={tab} page={page} who={who} papers={papers} connectedAgents={connectedAgents} owner={owner} editor={editor} />;
}
