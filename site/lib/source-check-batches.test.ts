// Pure client batching contracts with neutral public URLs; no server/network or publication calls.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { draftSourceUrls, runSourceCheckBatches, type SourceBatchReply } from './source-check-batches.ts';

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://docs.google.com/document/d/public-example-${i}`);
const reply = (batch: string[]): SourceBatchReply => ({ ok: true, batch: { record_id: 'app/boundary-example', posted: false, results: batch.map((reference, index) => ({ index, reference, status: 'retrieved', reason: 'Public text returned.', fix: 'Read the excerpt against the stated claim.' })) } });

test('twelve sources run as explicit sequential5+5+2 batches with globalindexes/progress', async () => {
 const input=urls(12), calls: string[][]=[], progress: number[]=[], batches: number[]=[];
 let active=0;
 const outcome=await runSourceCheckBatches(input, async (batch) => {
  assert.equal(active,0); active++; calls.push(batch);
  await Promise.resolve(); active--; return reply(batch);
 }, (p) => { progress.push(p.completed); batches.push(p.results.length); });
 assert.deepEqual(calls.map((b) => b.length),[5,5,2]);
 assert.deepEqual(calls.flat(),input);
 assert.deepEqual(progress,[0,5,10,12]); assert.deepEqual(batches,[0,5,10,12]);
 assert.deepEqual(outcome.results.map((r) => r.index),Array.from({length:12},(_,i)=>i));
 assert.deepEqual(outcome.results.map((r) => r.reference),input);
 assert.equal(outcome.feedback,undefined);
});

test('over-limit, empty, malformed and overlong URL input stops before any server action', async () => {
 for (const input of [[],urls(13),[''],['x'.repeat(2001)]]) {
  let calls=0;
  const outcome=await runSourceCheckBatches(input,async(batch)=>{calls++;return reply(batch);});
  assert.equal(calls,0); assert.equal(outcome.results.length,0); assert.equal(outcome.feedback?.code,'bad_request');
 }
});

test('a global service/auth failure stops subsequent batches without retrying and retains completedresults', async () => {
 let calls=0;
 const input=urls(12), feedback={code:'source_check_unavailable',message:'Checks are unavailable.',fix:'Keep the draft and retry later.'};
 const outcome=await runSourceCheckBatches(input,async(batch)=>{calls++;return calls===1?reply(batch):{ok:false,feedback};});
 assert.equal(calls,2); assert.equal(outcome.completed,5); assert.equal(outcome.results.length,5);
 assert.deepEqual(outcome.feedback,feedback);
});

test('individual held statuses remain perURLresults and do not imply publication or skip remaining sources', async () => {
 const input=urls(6); let calls=0;
 const outcome=await runSourceCheckBatches(input,async(batch)=>{
  calls++; const r=reply(batch);
  r.batch!.results[0].status='not_found'; r.batch!.results[0].reason='The public endpoint returned404.';
  return r;
 });
 assert.equal(calls,2); assert.equal(outcome.completed,6); assert.equal(outcome.results.length,6);
 assert.equal(outcome.results[0].status,'not_found'); assert.equal(outcome.results[5].status,'not_found');
});

test('an uncertain action transport outcome is not automaticallyretried or posted', async () => {
 let calls=0;
 const outcome=await runSourceCheckBatches(urls(6),async()=>{calls++;throw new Error('offline interruption');});
 assert.equal(calls,1); assert.equal(outcome.completed,0); assert.equal(outcome.feedback?.code,'source_check_unconfirmed');
});

test('result indices must exactly map each requested batch; malformed replies hold without retry', async () => {
 const input=urls(6); let calls=0;
 const outcome=await runSourceCheckBatches(input,async(batch)=>{
  calls++; const r=reply(batch); r.batch!.results[1].index=0; return r;
 });
 assert.equal(calls,1); assert.equal(outcome.completed,0); assert.equal(outcome.feedback?.code,'source_check_unconfirmed');
});

test('draft extraction is local, deduplicates URLs, trims prose punctuation, and preserves supportedsharequeries', () => {
 const source='https://docs.google.com/document/d/public-example-0?usp=sharing';
 assert.deepEqual(draftSourceUrls(`Boundary assumptions: ${source}.\nSee (${source}) and https://github.com/example/boundary/blob/main/README.md。`), [source,'https://github.com/example/boundary/blob/main/README.md']);
 assert.deepEqual(draftSourceUrls('For x=0 both sides vanish.'),[]);
 assert.equal(draftSourceUrls(urls(13).join('\n')).length,13,'do not silentlydrop excess URLs; validation explains the limit');
});

test('disposing the form/author context stops subsequent batches after an in-flight result', async () => {
 let live=true,calls=0;
 const outcome=await runSourceCheckBatches(urls(12),async(batch)=>{calls++;live=false;return reply(batch);},undefined,()=>live);
 assert.equal(calls,1); assert.equal(outcome.completed,5); assert.equal(outcome.feedback?.code,'source_check_cancelled');
});

test('an absent or contradictory server reply remains unconfirmed rather than throwing', async () => {
 const feedback={code:'source_check_unavailable',message:'Checks are unavailable.',fix:'Keep the draft.'};
 for(const response of [undefined,{...reply(urls(1)),feedback}] as unknown as SourceBatchReply[]) {
  const outcome=await runSourceCheckBatches(urls(1),async()=>response);
  assert.equal(outcome.completed,0); assert.equal(outcome.feedback?.code,'source_check_unconfirmed');
 }
});

test('historical observations retain their dated scope and cannot masquerade as fresh retrieval', async () => {
 const snapshot=reply(urls(1));
 snapshot.batch!.results[0]={...snapshot.batch!.results[0],status:'curated_public_snapshot',method:'signed_out_browser',
  observed_window_utc:{start:'2026-10-27T05:40:00Z',end:'2026-10-27T05:43:00Z'},digest_kind:'reviewed_observation_record_sha256',factual_summary:'A public source reports a scoped claim.'};
 const result=await runSourceCheckBatches(urls(1),async()=>snapshot);
 assert.equal(result.feedback,undefined);
 assert.deepEqual(result.results[0].observed_window_utc,snapshot.batch!.results[0].observed_window_utc);
 snapshot.batch!.results[0].observed_at='2026-10-27T06:00:00Z';
 assert.equal((await runSourceCheckBatches(urls(1),async()=>snapshot)).feedback?.code,'source_check_unconfirmed');
});


test('source feedback retains inert excerpts and historical caveats; malformed evidence stays unconfirmed', async () => {
 const fresh=reply(urls(1));fresh.batch!.results[0].excerpt='<b>Literal public text</b>';
 const actual=await runSourceCheckBatches(urls(1),async()=>fresh);
 assert.equal(actual.results[0].excerpt,'<b>Literal public text</b>');
 const history=reply(urls(1));history.batch!.results[0]={...history.batch!.results[0],status:'curated_public_snapshot',method:'signed_out_browser',
  observed_window_utc:{start:'2026-10-27T05:40:00Z',end:'2026-10-27T05:43:00Z'},digest_kind:'reviewed_observation_record_sha256',
  curated:{attribution_caveats:['Displayed account only.'],evidence_limits:['No proof verification.']}};
 assert.deepEqual((await runSourceCheckBatches(urls(1),async()=>history)).results[0].curated,history.batch!.results[0].curated);
 history.batch!.results[0].excerpt='Freshness cannot be inferred.';
 assert.equal((await runSourceCheckBatches(urls(1),async()=>history)).feedback?.code,'source_check_unconfirmed');
 fresh.batch!.results[0].excerpt='x'.repeat(2001);
 assert.equal((await runSourceCheckBatches(urls(1),async()=>fresh)).feedback?.code,'source_check_unconfirmed');
});
