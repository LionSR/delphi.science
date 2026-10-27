// Stateless public-source workflow: current explicit retrievals and separately reviewed server-owned historical observations stay distinct.
import { createHash } from 'node:crypto';
import { QueryError, type Db } from './query.ts';
import { lookupCuratedPublicSource, type CuratedPublicSnapshot } from './curated-public-sources.ts';
import { reserveAttempt, finishAttempt } from './moderation-audit.ts';
import type { Voter } from './votes.ts';
import { canonicalSource, retrieveSource, type SourceRetrieval, type SourceTarget } from './public-source-fetch.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const epoch=(v:unknown)=>typeof v==='string'?Date.parse(v):NaN;
const failureStatuses=['unsupported','not_found','unavailable','identity_mismatch','unsupported_format'] as const;
const fields=['adapter','author','blob_sha','canonical','digest','excerpt','fix','method','observed_at','path','reason','requested_ref','resolved_commit','response_status','status','title','file_mode','root_tree_sha'];
export type SourceRetriever=(target:SourceTarget,deadlineAt?:number)=>Promise<SourceRetrieval>;
const defaultRetriever:SourceRetriever=(t,deadline)=>retrieveSource(t,undefined,deadline);
export type CheckResult={index:number;reference:string;status:SourceRetrieval['status']|'curated_public_snapshot';reason:string;fix:string;observed_at?:string;adapter?:SourceRetrieval['adapter']|'drive_file';method?:string;response_status?:number;title?:string;author?:string;excerpt?:string;digest?:string;requested_ref?:string;resolved_commit?:string;path?:string;blob_sha?:string;file_mode?:string;root_tree_sha?:string;curated?:CuratedPublicSnapshot;observed_window_utc?:CuratedPublicSnapshot['observed_window_utc'];factual_summary?:string;digest_kind?:'remote_response_sha256'|'reviewed_observation_record_sha256'};
export type CheckBatch={record_id:string;results:CheckResult[];posted:false};
export type PublicEvidence={reference:string;status:'retrieved_public';url:string;adapter:string;method:string;observed_at:string;excerpt:string;digest:string;digest_kind?:'remote_response_sha256';title?:string;author?:string;requested_ref?:string;resolved_commit?:string;path?:string;blob_sha?:string;file_mode?:string;root_tree_sha?:string};
export type CollectOptions={deadlineMs?:number;allowCurated?:boolean};
function validResult(raw: unknown, target: SourceTarget): raw is SourceRetrieval {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
 const v = raw as Record<string, unknown>;
 if (Object.keys(v).some((k) => !fields.includes(k)) || v.canonical !== target.canonical || v.adapter !== target.adapter || v.method !== 'public-https-v1'
  || !['retrieved', ...failureStatuses].includes(String(v.status)) || typeof v.reason !== 'string' || !v.reason.trim() || v.reason.length > 500
  || typeof v.fix !== 'string' || !v.fix.trim() || v.fix.length > 500 || !Number.isFinite(epoch(v.observed_at))) return false;
 for (const [name, max] of [['title',200],['author',100],['excerpt',2000]] as const) if (v[name] !== undefined && (typeof v[name] !== 'string' || (v[name] as string).length > max)) return false;
 if (v.response_status !== undefined && (!Number.isInteger(v.response_status) || Number(v.response_status) < 100 || Number(v.response_status) > 599)) return false;
 if (v.status === 'retrieved') {
  if (v.response_status !== 200 || typeof v.excerpt !== 'string' || !v.excerpt.trim() || typeof v.digest !== 'string' || !/^[0-9a-f]{64}$/.test(v.digest)) return false;
  if (/oik_[0-9a-f]{48}/.test(JSON.stringify(v))) return false;
  if (target.adapter === 'github' && (!/^[0-9a-f]{40}$/.test(target.identity.ref) || v.resolved_commit !== target.identity.ref || v.requested_ref !== target.identity.ref || v.path !== target.identity.path || !/^[0-9a-f]{40}$/.test(String(v.resolved_commit)) || !/^[0-9a-f]{40}$/.test(String(v.blob_sha)) || !['100644','100755'].includes(String(v.file_mode)) || !/^[0-9a-f]{40}$/.test(String(v.root_tree_sha)))) return false;
 } else if (v.excerpt !== undefined || v.digest !== undefined || v.title !== undefined || v.author !== undefined) return false;
 return true;
}
/** Safe audit/display labels never preserve a caller's opaque URL query or credentials. */
export function safeSourceReference(reference:string):string {
 try{return canonicalSource(reference).canonical;}catch{
  const arxiv=reference.match(/^arxiv(?::|\/)(\d{4}\.\d{4,5})(?:v\d+)?$/i);
  return arxiv?`arxiv/${arxiv[1]}`:'Unsupported or unindexed reference';
 }
}
const unavailable=(index:number,reference:string):CheckResult=>({index,reference,status:'unavailable',reason:'A bounded public retrieval could not be completed within this request.',fix:'Keep the draft. Check this individual public source again explicitly; unavailability does not assess its scientific claim.'});
async function timed<T>(promise:Promise<T>,ms:number):Promise<T>{
 let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error('source deadline')),ms);})]);}
 finally{clearTimeout(timer!);}
}
/** Fresh request-scoped observations only; no preflight result or client verification token is accepted. */
export async function collectPublicSources(record:string,urls:string[],fetchSource:SourceRetriever=defaultRetriever,options:CollectOptions={}):Promise<CheckBatch>{
 if(!Array.isArray(urls)||!urls.length||urls.length>12||urls.some(u=>typeof u!=='string'||!u||u.length>2000))throw new QueryError('Send at most twelve source URLs for an explicit post.','Each URL must be at most 2,000 characters.');
 const deadline=Date.now()+Math.max(1,Math.min(options.deadlineMs??20_000,20_000));
 const results:CheckResult[]=Array(urls.length);let next=0;
 const run=async(input:string,index:number):Promise<CheckResult>=>{
  const snapshot=options.allowCurated?lookupCuratedPublicSource(record,input):undefined;
  if(snapshot)return {index,reference:snapshot.reference,status:'curated_public_snapshot',reason:'A repository-reviewed historical public observation is available; this is not a fresh network check.',fix:'Read its observation window and limits. Current availability or stronger claims still need an explicit fresh check or independent review.',observed_window_utc:snapshot.observed_window_utc,factual_summary:snapshot.factual_summary,digest_kind:snapshot.digest_kind,digest:snapshot.digest,adapter:snapshot.adapter,method:snapshot.method,curated:snapshot};
  let target:SourceTarget;
  try{target=canonicalSource(input);}catch{return {index,reference:'',status:'unsupported',reason:'This is not a supported safe public source URL.',fix:'Use a canonical supported public source without credentials or unsupported parameters.'};}
  const remaining=deadline-Date.now();if(remaining<=0)return unavailable(index,target.canonical);
  try{
   const result=await timed(fetchSource(target,deadline),remaining);
   if(!validResult(result,target))return unavailable(index,target.canonical);
   const {canonical,...rest}=result;
   return {...rest,index,reference:canonical,observed_at:new Date().toISOString(),...(result.digest?{digest_kind:'remote_response_sha256' as const}:{})};
  }catch{return unavailable(index,target.canonical);}
 };
 await Promise.all([0,1].map(async()=>{for(;;){const i=next++;if(i>=urls.length)return;results[i]=await run(urls[i],i);}}));
 return {record_id:record,results,posted:false};
}
/** Audit retains safe canonical identities/status/digests only, never excerpts, titles, author text or drafts. */
export function sourceAudit(batch:CheckBatch):string{
 return JSON.stringify({record_id:batch.record_id,results:batch.results.map(r=>({url:r.reference,canonical_hash:r.reference?hash(r.reference):null,status:r.status,adapter:r.adapter??null,method:r.method??null,response_status:r.response_status??null,digest:r.digest??null,digest_kind:r.digest_kind??null,observed_at:r.observed_at??null,observed_window_utc:r.observed_window_utc??null,requested_ref:r.requested_ref??null,resolved_commit:r.resolved_commit??null,path:r.path??null,blob_sha:r.blob_sha??null,file_mode:r.file_mode??null,root_tree_sha:r.root_tree_sha??null,observation_digest:r.curated?.digest??null,observation_digest_kind:r.curated?.digest_kind??null}))});
}
/** Authenticated preflight reserves one existing shared attempt for each batch of one to five URLs. */
export async function checkPublicSources(db:Db,who:Voter,record:string,urls:string[],fetchSource:SourceRetriever=defaultRetriever):Promise<CheckBatch>{
 if(!Array.isArray(urls)||!urls.length||urls.length>5||urls.some(u=>typeof u!=='string'||!u||u.length>2000))throw new QueryError('Send one to five public source URLs.','Each URL must be at most 2,000 characters.');
 if(!(await db.query('SELECT id FROM open_index.records WHERE id=$1 AND NOT gone',[record])).rows.length)throw new QueryError(`no record ${JSON.stringify(record)}`,'Open an existing research record.');
 const audit=await reserveAttempt(db,who,'source_check');
 const batch=await collectPublicSources(record,urls,fetchSource,{allowCurated:true});
 await finishAttempt(db,audit,false,`SOURCE_CHECK: ${sourceAudit(batch)}`);
 return batch;
}
export function publicEvidence(result:CheckResult):PublicEvidence|undefined{
 if(result.status!=='retrieved'||!result.excerpt||!result.digest||!result.adapter||!result.method||!result.observed_at)return;
 const {index:_,reason:__,fix:___,status:____,response_status:_____,curated:______,observed_window_utc:_______,factual_summary:________,digest_kind:_________,...data}=result;
 return {...data,digest_kind:'remote_response_sha256',status:'retrieved_public',url:result.reference,adapter:result.adapter as SourceRetrieval['adapter'],method:result.method,observed_at:result.observed_at,excerpt:result.excerpt,digest:result.digest};
}
