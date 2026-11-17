import type { NextConfig } from 'next';

const config: NextConfig = {
	// Local development runs Postgres in-process (lib/db.ts); its WebAssembly must not be bundled.
	serverExternalPackages: ['@electric-sql/pglite', 'mathjax-full', 'rehype-mathjax'],
	// Same-origin analytics script/intake requests must not receive page paths or query secrets.
	async headers() {
		// Approval pages must not be framed by another site.
		const unframed = [{ key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }];
		return [
			{ source: '/:path*', headers: [{ key: 'Referrer-Policy', value: 'strict-origin' }] },
			{ source: '/oauth/authorize', headers: unframed },
			{ source: '/keys/approve', headers: unframed },
		];
	},
};

export default config;
