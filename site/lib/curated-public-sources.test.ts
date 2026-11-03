// Curated registry validation and lookup.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import registry from './curated-public-sources.json' with { type: 'json' };
import { lookupCuratedPublicSource, validateCuratedPublicSourceRegistry } from './curated-public-sources.ts';

const record = 'openai-math/The-Exponential-Time-Hypothesis-is-False';
const reference = registry.observations[0].reference;
function neutralRegistry(): Record<string, any> {
  const observation = structuredClone(registry.observations[0]);
  observation.title = 'Public calculation note';
  observation.attributed_author = 'Displayed public account';
  observation.factual_summary = 'The note describes the endpoint terms in an open-chain sum.';
  observation.attribution_caveats = ['The display attribution is not independent identity authentication.'];
  return { schema_version: 1, observations: [observation] };
}
const invalid = (change: (value: Record<string, any>) => void) => {
  const value = neutralRegistry(); change(value);
  assert.throws(() => validateCuratedPublicSourceRegistry(value), /Invalid server-owned/);
};

test('shipped registry validates and exact configured scope yields historical evidence', () => {
  assert.doesNotThrow(() => validateCuratedPublicSourceRegistry(registry));
  assert.doesNotThrow(() => validateCuratedPublicSourceRegistry(neutralRegistry()));
  for (const row of registry.observations) {
    const snapshot = lookupCuratedPublicSource(record, row.reference)!;
    assert.equal(snapshot.status, 'curated_public_snapshot');
    assert.equal(snapshot.visibility, 'public_at_observation');
    assert.equal(snapshot.method, 'signed_out_browser');
    assert.equal(snapshot.digest_kind, 'reviewed_observation_record_sha256');
    assert.match(snapshot.digest, /^[a-f0-9]{64}$/);
    assert.ok(snapshot.evidence_limits.some(limit => limit.includes('current availability')));
    assert.ok(snapshot.evidence_limits.some(limit => limit.includes('failed current network attempt')));
    assert.equal('excerpt' in snapshot, false);
    assert.equal('response_status' in snapshot, false);
    assert.equal('observed_at' in snapshot, false);
  }
});

test('lookup matches canonical safe identity and exact record scope only', () => {
  assert.equal(lookupCuratedPublicSource(record, `${reference}/edit?usp=sharing`)?.reference, reference);
  assert.equal(lookupCuratedPublicSource(record.toLowerCase(), reference), undefined);
  assert.equal(lookupCuratedPublicSource('', reference), undefined);
  assert.equal(lookupCuratedPublicSource(record, `${reference}/copy`), undefined);
  assert.equal(lookupCuratedPublicSource(record, `${reference}?access_token=unavailable`), undefined);
  assert.equal(lookupCuratedPublicSource(record, reference.replace('https:', 'http:')), undefined);
  const x = registry.observations.find(row => row.adapter === 'x_post')!.reference;
  assert.equal(lookupCuratedPublicSource(record, x.replace('rrwilliams', 'anotheraccount')), undefined);
  assert.equal(lookupCuratedPublicSource(record, 'https://example.org/public-note'), undefined);
  const child = registry.observations.find(row => row.adapter === 'drive_file')!.reference;
  assert.equal(lookupCuratedPublicSource(record, `${child}?usp=sharing`)?.adapter, 'drive_file');
  assert.equal(lookupCuratedPublicSource(record, child.replace('/view', '/preview')), undefined);
  assert.equal(lookupCuratedPublicSource(record, `${child}?resourcekey=unavailable`), undefined);
  assert.equal(lookupCuratedPublicSource(record, child.replace('drive.google.com', 'drive.google.com.example.org')), undefined);
});

test('digest hashes the canonical reviewed record rather than page bytes or plain summary', () => {
  const snapshot = lookupCuratedPublicSource(record, reference)!;
  const { status: _, digest, digest_kind: __, evidence_limits: ___, ...observation } = snapshot;
  const expected = createHash('sha256').update(JSON.stringify({ schema_version: 1, observation })).digest('hex');
  assert.equal(digest, expected);
  assert.notEqual(digest, createHash('sha256').update(snapshot.factual_summary).digest('hex'));
});

test('returned observations are deeply immutable and validation cannot register caller data', () => {
  const snapshot = lookupCuratedPublicSource(record, reference)!;
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.review));
  assert.ok(Object.isFrozen(snapshot.observed_window_utc));
  assert.ok(Object.isFrozen(snapshot.attribution_caveats));
  assert.ok(Object.isFrozen(snapshot.evidence_limits));
  assert.throws(() => { (snapshot as any).factual_summary = 'Changed calculation summary.'; }, TypeError);
  const custom = neutralRegistry();
  validateCuratedPublicSourceRegistry(custom);
  assert.notEqual(lookupCuratedPublicSource(record, reference)?.factual_summary, custom.observations[0].factual_summary);
});

test('unknown authority fields and structural errors fail closed', () => {
  invalid(value => { value.verified = true; });
  invalid(value => { value.observations[0].verified = true; });
  invalid(value => { value.observations[0].status = 'retrieved'; });
  invalid(value => { value.observations[0].review.approved = true; });
  invalid(value => { delete value.observations[0].review; });
  invalid(value => { value.schema_version = 2; });
  invalid(value => { value.observations = {}; });
  invalid(value => { value.observations.push(structuredClone(value.observations[0])); });
  invalid(value => { value.observations[0].record_id = ''; });
  invalid(value => { value.observations[0].adapter = 'drive_folder'; });
  invalid(value => { value.observations[0].reference += '/edit'; });
  invalid(value => { value.observations[0].visibility = 'currently_public'; });
  invalid(value => { value.observations[0].method = 'client_verified'; });
});

test('bounded inert text, public identities and honest observation windows are required', () => {
  invalid(value => { value.observations[0].title = 'n'.repeat(241); });
  invalid(value => { value.observations[0].attributed_author = 'n'.repeat(201); });
  invalid(value => { value.observations[0].factual_summary = 'n'.repeat(2001); });
  invalid(value => { value.observations[0].factual_summary = '<p>Endpoint terms remain.</p>'; });
  invalid(value => { value.observations[0].factual_summary = `Public note ${'oik_' + 'a'.repeat(48)}`; });
  invalid(value => { value.observations[0].factual_summary = 'See https://example.org/note?access_token=unavailable'; });
  invalid(value => { value.observations[0].attribution_caveats = []; });
  invalid(value => { value.observations[0].attribution_caveats = Array(9).fill('Display attribution only.'); });
  invalid(value => { value.observations[0].observed_window_utc.start = '2026-10-27'; });
  invalid(value => { value.observations[0].observed_window_utc.start = '2026-02-30T05:40:00Z'; });
  invalid(value => { value.observations[0].observed_window_utc.end = '2026-10-27T05:39:00Z'; });
  invalid(value => { value.observations[0].observed_window_utc.end = '2026-10-29T05:43:00Z'; });
  invalid(value => { value.observations[0].review.process = 'Client verification'; });
});
