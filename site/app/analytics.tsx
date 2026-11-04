'use client';
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { analyticsContextSafe, analyticsEvent, analyticsPath } from '#lib/analytics.ts';

function contextSafe() {
	try { return analyticsContextSafe(document.referrer, localStorage.getItem('__va_attribution')); }
	catch { return false; }
}

function beforeSend(event: BeforeSendEvent) {
	return contextSafe() ? analyticsEvent(event) : null;
}

export function PageViews() {
	const pathname = usePathname() ?? '';
	const path = analyticsPath(pathname);
	const [safe, setSafe] = useState(false);
	useEffect(() => { setSafe(contextSafe()); }, []);
	if (!safe || !path || !contextSafe()) return null;
	// Explicit routes avoid the Next wrapper deriving dynamic-path names from URL query keys.
	// Remount for distinct records that share one canonical route, so each visit still counts.
	return <Analytics key={pathname} route={path} path={path} beforeSend={beforeSend}
		framework="next" debug={false}
		basePath={process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH}
		configString={process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG} />;
}
