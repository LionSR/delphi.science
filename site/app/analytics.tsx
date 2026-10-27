'use client';
// Page views, counted by Vercel Web Analytics: cookieless, and a visitor is a hash of the request that
// Vercel drops after a day. The event URL keeps only the origin and an approved public route pattern.
import { Analytics } from '@vercel/analytics/next';
import { analyticsEvent } from '../lib/analytics.ts';

export const PageViews = () => <Analytics beforeSend={analyticsEvent} />;
