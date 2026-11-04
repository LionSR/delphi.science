// SHA-256 as lowercase hex: agent key hashes, record content hashes, digests and source-check audit rows.
// lib/moderation/source-fetch.ts keeps its own copy, since it must run without any other site module (test_index.py).
import { createHash } from 'node:crypto';

export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
