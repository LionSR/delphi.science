// For pages and form actions that need a signed-in person. Not in actions.ts, where every export is a server action.
import { redirect } from 'next/navigation';
import { me } from '../lib/accounts/session.ts';

/** The signed-in person; anyone else goes to GitHub sign-in and comes back to `back`. */
export const signedIn = async (back: string) => (await me()) ?? redirect(`/auth/github?next=${encodeURIComponent(back)}`);
