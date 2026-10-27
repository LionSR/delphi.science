'use client';

import { useEffect, useRef, useState } from 'react';
import { checkRecordSources } from './actions.ts';
import { draftSourceUrls, MAX_DRAFT_SOURCES, runSourceCheckBatches, type SourceCheckProgress } from '../lib/source-check-batches.ts';

type Props = { record: string; owner: string; draft: string; disabled: boolean; onBusyChange: (busy: boolean) => void; onSignIn: () => void };
const link = (reference: string) => {
 try { const url=new URL(reference); return url.protocol==='https:' && !url.username && !url.password && !url.port && !url.hash && !url.search
  && ['github.com','docs.google.com','drive.google.com','x.com'].includes(url.hostname) ? url.href : undefined; }
 catch { return; }
};

const labels: Record<string,string> = { retrieved:'Live public retrieval',curated_public_snapshot:'Reviewed historical observation',not_found:'Not found',
 unavailable:'Unavailable',unsupported:'Unsupported source',identity_mismatch:'Identity mismatch',unsupported_format:'Unsupported format' };

/** Preflight reserves an attempt and inspects sources; it never submits the surrounding draft. */
export function SourceChecks({ record, owner, draft, disabled, onBusyChange, onSignIn }: Props) {
 const [urls,setUrls]=useState('');
 const [progress,setProgress]=useState<SourceCheckProgress>();
 const [busy,setBusy]=useState(false);
 const running=useRef(false), generation=useRef(0);
 useEffect(()=>{
  generation.current++;
  return ()=>{ generation.current++; running.current=false; onBusyChange(false); };
 },[owner,record,onBusyChange]);
 useEffect(()=>{ if(!draft.trim()) {setUrls('');setProgress(undefined);} },[draft]);
 const check=async()=>{
  if (disabled || running.current) return;
  if (!owner) { onSignIn(); return; }
  running.current=true; const current=generation.current;
  setBusy(true); onBusyChange(true);
  const input=[...new Set(urls.trim() ? urls.split(/\s+/).map((u)=>u.trim()).filter(Boolean) : draftSourceUrls(draft))];
  if(!urls.trim())setUrls(input.join('\n'));
  const live=()=>generation.current===current;
  try {
   const result=await runSourceCheckBatches(input,async(batch)=>{
    const reply=await checkRecordSources({record,urls:batch});
    if(reply.batch && reply.batch.record_id!==record)return {ok:false,feedback:{code:'source_check_unconfirmed',message:'The source result belongs to another record.',fix:'Keep the draft and reopen this record before checking again.'}};
    return reply;
   },(state)=>{if(live())setProgress(state);},live);
   if(live())setProgress(result);
  } catch {
   if(live())setProgress({completed:0,total:input.length,results:[],feedback:{code:'source_check_unconfirmed',message:'The source check could not be confirmed.',fix:'Your draft is retained. No post was submitted; review the results before checking again.'}});
  } finally {
   if(live()){running.current=false;setBusy(false);onBusyChange(false);}
  }
 };
 return <section className="source-checks">
  <h3>Public source checks</h3>
  <p className="count">Inspect up to {MAX_DRAFT_SOURCES} public URLs in batches of five. Results distinguish live public retrieval from dated, repository-reviewed observations. Neither certifies a research claim.</p>
  <label>Public source URLs
   <textarea rows={3} aria-label="Public source URLs" maxLength={24_012} value={urls} onChange={(event)=>{setUrls(event.target.value);setProgress(undefined);}} placeholder="One URL per line; leave empty to use URLs from your draft" disabled={disabled || busy} />
  </label>
  <button type="button" disabled={disabled || busy} onClick={()=>{setUrls(draftSourceUrls(draft).join('\n'));setProgress(undefined);}}>Use URLs from draft</button>{' '}
  <button type="button" disabled={disabled || busy} onClick={check}>{busy?'Checking public sources…':owner?'Check public sources':'Sign in to check sources'}</button>
  <p className="count">Your draft stays here. Checking never posts it. Each batch consumes one of the shared 30 daily check/submission attempts. Repository-reviewed observations describe their recorded time; optional live rechecking on submission requires consent below. Every submission still passes the DeepSeek quality gate.</p>
  {progress && <div aria-live="polite">
   <p className="count">{progress.completed} of {progress.total} URLs checked{busy?'…':'.'} No post was submitted by this check.</p>
   {progress.feedback && <div className="post-feedback" role="alert"><p>{progress.feedback.message}</p><p>{progress.feedback.fix}</p></div>}
   {progress.results.length>0 && <ol>{progress.results.map((result)=>{const href=link(result.reference);return <li key={result.index} style={{overflowWrap:'anywhere'}}>
    <p>{href?<a href={href} target="_blank" rel="noopener noreferrer">{result.reference}</a>:result.reference||`URL ${result.index+1}`} — <strong>{labels[result.status]??result.status}</strong></p>
    <p>{result.reason}</p><p>{result.fix}</p>
    {result.factual_summary && <p>{result.factual_summary}</p>}
    {result.status==='retrieved' && result.excerpt && <details><summary>Retrieved text excerpt</summary><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit'}}>{result.excerpt}</pre><p className="count">Untrusted source text; compare it with the claim yourself.</p></details>}
    {result.status==='curated_public_snapshot' && result.curated && <details><summary>Attribution caveats and evidence limits</summary><ul>{[...result.curated.attribution_caveats,...result.curated.evidence_limits].map((item,index)=><li key={index}>{item}</li>)}</ul></details>}
    {result.status==='curated_public_snapshot' && result.observed_window_utc
     ? <p className="count">Publicly observed {result.observed_window_utc.start}–{result.observed_window_utc.end}. Reviewed summary, not a fresh fetch; its digest identifies the observation record, not remote page bytes.</p>
     : (result.adapter||result.method||result.observed_at) && <p className="count">{[result.adapter,result.method,result.observed_at?`Retrieved ${result.observed_at}`:undefined].filter(Boolean).join(' · ')}</p>}
   </li>;})}</ol>}
  </div>}
 </section>;
}
