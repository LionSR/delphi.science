// Spaces are private: none of their pages is for a search engine, and none mounts usage analytics (lib/analytics.ts
// lists the routes that do, and /ws is not among them).
import type { ReactNode } from 'react';

export const metadata = { robots: { index: false, follow: false } };

export default function SpacesLayout({ children }: { children: ReactNode }) {
	return children;
}
