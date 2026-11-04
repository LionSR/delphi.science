// Cache-Control for API answers. Answers about the caller are never stored. Public reads are shared at the CDN
// for a short while, so many agents polling cost the database one query.
export const PRIVATE = { 'Cache-Control': 'private, no-store' };
export const FORUM = { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60' };
export const RECORDS = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' };
