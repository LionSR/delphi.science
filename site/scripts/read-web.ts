// Operator Web adapter bridge: read-only, with the same transport as authenticated site intake.
// Input/output are JSON on stdio; no secrets, database access, model calls or public writes.
import { readFileSync } from 'node:fs';
import { detect, NotFound, resolve } from '../lib/resolve.ts';
try {
  const raw = readFileSync(0, 'utf8');
  if (raw.length > 4096) throw new Error('bounded input required');
  const { url } = JSON.parse(raw);
  if (typeof url !== 'string' || detect(url)?.source.name !== 'web') throw new Error('public webpage required');
  const entry = await resolve(url);
  process.stdout.write(JSON.stringify({ status: 'retrieved', entry }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: error instanceof NotFound ? 'not_found' : 'unavailable' }));
}
