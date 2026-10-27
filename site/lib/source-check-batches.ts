// Client-side orchestration only. Each batch still authenticates and validates on the server.
import type { PostFeedback } from './post-feedback.ts';

export const MAX_DRAFT_SOURCES = 12;
export const SOURCE_BATCH_SIZE = 5;
export type SourceUiResult = { index: number; reference: string; status: string; reason: string; fix: string; observed_at?: string; adapter?: string; method?: string;
 observed_window_utc?: { start: string; end: string }; factual_summary?: string; digest_kind?: string; excerpt?: string; curated?: { attribution_caveats: readonly string[]; evidence_limits: readonly string[] } };
export type SourceBatchReply = { ok: boolean; batch?: { record_id: string; results: SourceUiResult[]; posted: false }; feedback?: PostFeedback };
export type SourceCheckProgress = { completed: number; total: number; results: SourceUiResult[]; feedback?: PostFeedback };
const statuses = new Set(['retrieved','unsupported','not_found','unavailable','identity_mismatch','unsupported_format','pending','rate_limited','capacity_hold','curated_public_snapshot']);
const unconfirmed = (): PostFeedback => ({ code: 'source_check_unconfirmed', message: 'The source check could not be confirmed.', fix: 'Your URLs and draft are retained. Check the results before requesting another check; no post was submitted by this action.' });

/** Extraction does no retrieval or authorization; the author can inspect/edit the resulting URL list. */
export function draftSourceUrls(text: string): string[] {
 return [...new Set((text.match(/https?:\/\/[^\s<>"'()[\]{}\u0060《》〈〉「」『』【】（）。，；：！？、]+/gi) ?? []).map((url) => url.replace(/[.:!?]+$/, '')))];
}

function checkedResults(reply: SourceBatchReply, count: number): SourceUiResult[] | undefined {
 const result=reply.batch;
 if (reply.ok !== true || !result || result.posted !== false || typeof result.record_id !== 'string' || !result.record_id || !Array.isArray(result.results) || result.results.length !== count) return;
 const seen=new Set<number>();
 for (const r of result.results) {
  if (!r || !Number.isInteger(r.index) || r.index < 0 || r.index >= count || seen.has(r.index) || typeof r.reference !== 'string' || r.reference.length > 2000
   || !statuses.has(r.status) || typeof r.reason !== 'string' || !r.reason || r.reason.length > 1000 || typeof r.fix !== 'string' || !r.fix || r.fix.length > 1000
   || (r.observed_at !== undefined && (typeof r.observed_at !== 'string' || !Number.isFinite(Date.parse(r.observed_at))))) return;
  seen.add(r.index);
  if (r.status === 'curated_public_snapshot') {
   const window=r.observed_window_utc;
   if (r.observed_at !== undefined || r.method !== 'signed_out_browser' || r.digest_kind !== 'reviewed_observation_record_sha256'
    || !window || !Number.isFinite(Date.parse(window.start)) || !Number.isFinite(Date.parse(window.end))
    || Date.parse(window.start)>Date.parse(window.end)) return;
  }
  if (r.excerpt !== undefined && (typeof r.excerpt !== 'string' || r.excerpt.length>2000 || r.status!=='retrieved')) return;
  if (r.curated !== undefined && (r.status!=='curated_public_snapshot' || ![r.curated.attribution_caveats,r.curated.evidence_limits].every((items)=>Array.isArray(items) && items.length<=12 && items.every((item)=>typeof item==='string' && item.length<=2000)))) return;
  if (r.factual_summary !== undefined && (typeof r.factual_summary !== 'string' || r.factual_summary.length>2000)) return;
 }
 return [...result.results].sort((a,b)=>a.index-b.index);
}

/** One explicit click: no automatic retry, publication, scheduling or source-result reuse. */
export async function runSourceCheckBatches(urls: string[], run: (batch: string[]) => Promise<SourceBatchReply>, progress?: (value: SourceCheckProgress) => void, continueChecking: () => boolean = () => true): Promise<SourceCheckProgress> {
 const results: SourceUiResult[]=[];
 const state: SourceCheckProgress={completed:0,total:urls.length,results};
 if (!urls.length || urls.length > MAX_DRAFT_SOURCES || urls.some((u)=>typeof u !== 'string' || !u.trim() || u.length > 2000)) {
  return {...state,feedback:{code:'bad_request',message:'Choose one to twelve public source URLs.',fix:'Use at most twelve URLs, each at most 2,000 characters. Checks run in batches of five.'}};
 }
 progress?.({...state,results:[]});
 for (let offset=0;offset<urls.length;offset+=SOURCE_BATCH_SIZE) {
  if (!continueChecking()) return {...state,results:[...results],feedback:{code:'source_check_cancelled',message:'Source checking stopped because the form or signed-in author changed.',fix:'Open the current author’s form and choose the URLs explicitly before checking again.'}};
  const batch=urls.slice(offset,offset+SOURCE_BATCH_SIZE);
  let reply: SourceBatchReply;
  try { reply=await run(batch); } catch { return {...state,results:[...results],feedback:unconfirmed()}; }
  if (!reply || typeof reply !== 'object') return {...state,results:[...results],feedback:unconfirmed()};
  if (reply.ok === false) return {...state,results:[...results],feedback:reply.feedback ?? unconfirmed()};
  if (reply.feedback) return {...state,results:[...results],feedback:unconfirmed()};
  const checked=checkedResults(reply,batch.length);
  if (!checked) return {...state,results:[...results],feedback:unconfirmed()};
  results.push(...checked.map((r)=>({...r,index:r.index+offset})));
  state.completed=offset+batch.length;
  progress?.({...state,results:[...results]});
 }
 return {...state,results:[...results]};
}
