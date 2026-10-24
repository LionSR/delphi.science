import type { NextConfig } from 'next';

const config: NextConfig = {
	// Local development runs Postgres in-process (lib/db.ts); its WebAssembly must not be bundled.
	serverExternalPackages: ['@electric-sql/pglite'],
};

export default config;
