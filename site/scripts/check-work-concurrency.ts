// Explicitly isolated PostgreSQL probe: starts its own disposable container, never reads DATABASE_URL.
// Requires Docker and pgvector/pgvector:pg17. Run: node --experimental-strip-types scripts/check-work-concurrency.ts
import {execFileSync} from 'node:child_process';
import {strict as assert} from 'node:assert';
import postgres from 'postgres';
import {migrations} from '#lib/testing.ts';

const docker=['--host=unix:///var/run/docker.sock'];
const name=`delphi-work-concurrency-${process.pid}`;
const env={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
const run=(...args:string[])=>execFileSync('docker',[...docker,...args],{encoding:'utf8',env,timeout:30000}).trim();
let sql:ReturnType<typeof postgres>|undefined;
try{
 run('run','--rm','-d','--name',name,'-e','POSTGRES_PASSWORD=isolated-probe-only','-p','127.0.0.1::5432','pgvector/pgvector:pg17');
 const port=run('port',name,'5432/tcp').split(':').pop();
 let ready=false;
 for(let i=0;i<50;i++){
  try{run('exec',name,'pg_isready','-h','127.0.0.1','-U','postgres');ready=true;break;}
  catch{await new Promise(r=>setTimeout(r,100));}
 }
 assert.ok(ready,'isolated PostgreSQL must become ready');
 sql=postgres(`postgresql://postgres:isolated-probe-only@127.0.0.1:${port}/postgres`,{max:4,connect_timeout:5,onnotice:()=>{}});
 for(const m of migrations())await sql.begin(tx=>tx.unsafe(m.sql));
 const proof=(value:string,zenodo?:string)=>({scheme:'doi',value,verified_by:zenodo?'zenodo-record':'doi-csl',evidence:zenodo?`https://zenodo.org/api/records/${zenodo}`:`https://doi.org/${value.toLowerCase()}`});
 for(const reverse of [false,true]){
  const n=reverse?'88002':'88001',doi=`10.5281/zenodo.${n}`;
  const sources=[{id:`doi/10.5281__ZENODO.${n}`,identity:proof(doi.toUpperCase())},{id:`zenodo/${n}`,identity:proof(doi,n)}];
  if(reverse)sources.reverse();
  const a=await sql.reserve(),b=await sql.reserve();
  try{
   await a`BEGIN`;await b`BEGIN`;
   const [{pid}]=await b`SELECT pg_backend_pid() pid`;
   await a`INSERT INTO open_index.entries(id,entry) VALUES(${sources[0].id},${a.json({title:'Concurrent work',identity:sources[0].identity})})`;
   let complete=false;
   const pending=b`INSERT INTO open_index.entries(id,entry) VALUES(${sources[1].id},${b.json({title:'Concurrent alias',identity:sources[1].identity})})`.then(()=>{complete=true;});
   // Assert actual cross-backend contention on the identity lock before releasing the first writer.
   let blocked=false;
   for(let i=0;i<100;i++){
    const [state]=await sql`SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=${pid}`;
    if(state.wait_event_type==='Lock'&&state.wait_event==='advisory'){blocked=true;break;}
    await new Promise(r=>setTimeout(r,20));
   }
   assert.ok(blocked&&!complete,'second backend must wait on the normalized DOI lock');
   await a`COMMIT`;await pending;await b`COMMIT`;
  }finally{await a`ROLLBACK`;await b`ROLLBACK`;a.release();b.release();}
  const ids=sources.map(s=>s.id);
  const roots:{id:string;main_record_id:string}[]=await sql`SELECT id,main_record_id FROM open_index.works WHERE id=ANY(${ids})`;
  assert.deepEqual(roots.map(r=>r.id),[sources[0].id]);
  const members:{work_id:string}[]=await sql`SELECT work_id FROM open_index.work_records WHERE record_id=ANY(${ids})`;
  assert.equal(members.length,2);assert.ok(members.every(m=>m.work_id===sources[0].id));
  assert.equal((await sql`SELECT * FROM open_index.work_identifiers WHERE doi=${doi}`).length,1);
 }
 // An operator moving the original singleton races a previously unseen alias. The waiting
 // importer must use the reviewed target, directly after the lock or after a safe retry.
 const n='88003',doi=`10.5281/zenodo.${n}`,source=`doi/10.5281__zenodo.${n}`,target='test/operator-main',alias=`zenodo/${n}`;
 await sql`INSERT INTO open_index.entries(id,entry) VALUES(${target},${sql.json({title:'Reviewed main'})}),(${source},${sql.json({title:'Original DOI source',identity:proof(doi)})})`;
 const operator=await sql.reserve(),importer=await sql.reserve();
 try{
  await operator`BEGIN`;await importer`BEGIN`;
  const [{pid}]=await importer`SELECT pg_backend_pid() pid`;
  await operator`SELECT open_index.associate_work_source(${target},${source},${source},'probe-reviewer','["https://example.org/evidence"]'::jsonb,'Reviewed work','Paper','Paper publication',${source})`;
  const pending=importer`INSERT INTO open_index.entries(id,entry) VALUES(${alias},${importer.json({title:'New alias',identity:proof(doi,n)})})`.then(()=>null,error=>error);
  let blocked=false;
  for(let i=0;i<100;i++){
   const [state]=await sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
   if(state.wait_event_type==='Lock'){blocked=true;break;}
   await new Promise(r=>setTimeout(r,20));
  }
  assert.ok(blocked,'import must wait for the moving canonical root');
  await operator`COMMIT`;
  const outcome=await pending;
  if(outcome){
   assert.match(String(outcome),/Canonical work changed/);await importer`ROLLBACK`;
   await importer`INSERT INTO open_index.entries(id,entry) VALUES(${alias},${importer.json({title:'New alias',identity:proof(doi,n)})})`;
  }else await importer`COMMIT`;
  const members:{work_id:string}[]=await sql`SELECT work_id FROM open_index.work_records WHERE record_id=ANY(${[target,source,alias]})`;
  assert.equal(members.length,3);assert.ok(members.every(m=>m.work_id===target));
 }finally{await operator`ROLLBACK`;await importer`ROLLBACK`;operator.release();importer.release();}
 console.log('PASS: PostgreSQL 17, two independent backends, both first-arrival orders; one work and two sources immediately after insertion. Operator-vs-alias contention preserves the reviewed target without splitting identity.');
}finally{await sql?.end({timeout:2});try{run('stop',name);}catch{/* startup may have failed */}}
