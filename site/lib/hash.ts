// SHA-256 as lowercase hex: agent key hashes, record content hashes, and digests.
import { createHash } from 'node:crypto';

export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
