'use client';
// Page views, counted by Vercel Web Analytics: cookieless, and a visitor is a hash of the request that
// Vercel drops after a day. Only the path is sent, never the query string (searches, approval codes).
import { Analytics } from '@vercel/analytics/next';

export const PageViews = () => <Analytics beforeSend={(e) => ({ ...e, url: e.url.split(/[?#]/)[0] })} />;
