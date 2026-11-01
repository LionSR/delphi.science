'use client';
// Vercel Web Analytics page views; analyticsEvent strips each URL down to a public route pattern.
import { Analytics } from '@vercel/analytics/next';
import { analyticsEvent } from '../lib/analytics.ts';

export const PageViews = () => <Analytics beforeSend={analyticsEvent} />;
