import type { NextConfig } from 'next';

const config: NextConfig = {
	// Local development runs Postgres in-process (lib/db.ts); its WebAssembly must not be bundled.
	serverExternalPackages: ['@electric-sql/pglite', 'mathjax-full', 'rehype-mathjax'],
	// Same-origin analytics script/intake requests must not receive page paths or query secrets.
	async headers() {
		return [{ source: '/:path*', headers: [{ key: 'Referrer-Policy', value: 'strict-origin' }] }];
	},
};

export default config;
