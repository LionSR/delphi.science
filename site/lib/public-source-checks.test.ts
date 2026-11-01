// Public-source checks with scripted retrievals; no network.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { checkPublicSources, collectPublicSources } from './public-source-checks.ts';
import type { SourceRetrieval, SourceTarget } from './public-source-fetch.ts';
const url='https://docs.google.com/document/d/abcdefghij1234567890/edit';
const who={login:'offline-author',agent:'Offline test'},record='app/boundary-calculation';
async function database(audit=true) {
 const db=new PGlite();
 await db.exec("CREATE SCHEMA open_index; CREATE TABLE open_index.records(id text PRIMARY KEY,gone boolean DEFAULT false); INSERT INTO open_index.records(id) VALUES ('app/boundary-calculation');");
 if(audit) await db.exec("CREATE TABLE open_index.moderations(id serial PRIMARY KEY,voter text,agent text,kind text,publish boolean,reason text,at timestamptz DEFAULT now());");
 return db;
}
const retrieved=async(t:SourceTarget):Promise<SourceRetrieval>=>({canonical:t.canonical,adapter:t.adapter,method:'public-https-v1',status:'retrieved',reason:'A bounded public text export was returned.',fix:'Inspect the excerpt against the precise claim.',observed_at:new Date().toISOString(),response_status:200,excerpt:'For an open chain the telescoping sum retains two endpoint terms.',digest:'a'.repeat(64)});

test('missing record or ledger prevents every retrieval',async()=>{
 const db=await database(false);let calls=0;
 try {
  await assert.rejects(checkPublicSources(db,who,record,[url],async(t)=>{calls++;return retrieved(t);}),/reserve/);
  await assert.rejects(checkPublicSources(db,who,'app/missing',[url],retrieved),/no record/);
  assert.equal(calls,0);
 }finally{await db.close();}
});

test('preflight reserves one attempt per five-URL batch; later explicit checks are fresh',async()=>{
 const db=await database();let calls=0;
 const fetch=async(t:SourceTarget)=>{calls++;return retrieved(t);};
 try {
  const a=await checkPublicSources(db,who,record,[url,url.replace('abcdefghij1234567890','klmnopqrst1234567890')],fetch);
  assert.equal(a.posted,false);assert.equal(a.results.length,2);
  assert.equal((await db.query('SELECT * FROM open_index.moderations')).rows.length,1);
  await checkPublicSources(db,who,record,[url],fetch);assert.equal(calls,3);
  assert.equal((await db.query('SELECT * FROM open_index.moderations')).rows.length,2);
  const log=(await db.query<{reason:string;publish:boolean}>('SELECT reason,publish FROM open_index.moderations')).rows;
  assert.ok(log.every(r=>!r.publish&&!r.reason.includes('telescoping')&&!r.reason.includes('excerpt')));
  assert.match(log[0].reason,/canonical_hash/);
 }finally{await db.close();}
});

test('owner-wide atomic limits include agents and stop retrieval before network activity',async()=>{
 const db=await database();let calls=0;
 try {
  await db.query("INSERT INTO open_index.moderations(voter,agent,kind,publish,reason) SELECT $1,'','comment',false,'bounded prior attempt' FROM generate_series(1,29)",[who.login]);
  const fetch=async(t:SourceTarget)=>{calls++;return retrieved(t);};
  const result=await Promise.allSettled([checkPublicSources(db,who,record,[url],fetch),checkPublicSources(db,{...who,agent:'Other agent'},record,[url],fetch)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);
  assert.equal((await db.query('SELECT * FROM open_index.moderations')).rows.length,30);
 }finally{await db.close();}
});

test('an observed failure or identity mismatch cannot become successful source evidence',async()=>{
 const db=await database();
 try {
  const a=await checkPublicSources(db,who,record,[url],async(t)=>({...await retrieved(t),status:'not_found',response_status:404,excerpt:undefined,digest:undefined}));
  assert.equal(a.results[0].status,'not_found');
  const b=await checkPublicSources(db,who,record,[url],async(t)=>({...await retrieved(t),canonical:'https://docs.google.com/document/d/anotherdocument123'}));
  assert.equal(b.results[0].status,'unavailable');
 }finally{await db.close();}
});

test('five-URL preflight limit is separate from twelve-reference explicit posting limit',async()=>{
 const db=await database();
 try {
  await assert.rejects(checkPublicSources(db,who,record,Array(6).fill(url),retrieved),/one to five/);
  const a=await collectPublicSources(record,Array(12).fill(url),retrieved);assert.equal(a.results.length,12);
  await assert.rejects(collectPublicSources(record,Array(13).fill(url),retrieved),/twelve/);
 }finally{await db.close();}
});

test('aggregate deadline holds slow retrievals and never auto retries',async()=>{
 let calls=0;
 const a=await collectPublicSources(record,[url],async()=>{calls++;return await new Promise<SourceRetrieval>(()=>{});},{deadlineMs:10});
 assert.equal(calls,1);assert.equal(a.results[0].status,'unavailable');
});
