// Offline atomic-vote contracts on migrated in-process Postgres; no live votes or provider requests.
import { strict as assert } from 'node:assert';
import { before, after, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { load } from './load.ts';
import { vote, createAgentKey, revokeKey, type Vote } from './votes.ts';
import { QueryError, type Db } from './query.ts';
import { spec } from './openapi.ts';
import { closed } from './schema.ts';
import type { Moderator } from './moderate.ts';
registerHooks({resolve:(name,context,next)=>next(name==='next/server'?'next/server.js':name,context)});
const pg=new PGlite({extensions:{vector}}),who={login:'atomic-owner',agent:'Interest Bot'};
const accept:Moderator=async()=>({decision:'ACCEPT',reason:'A scoped boundary-condition observation.',fix:'',verification_needed:false});
const record=(name:string)=>`app/atomic-${name}`;
type StoredVote={record_id:string;voter:string;agent:string;value:number|null;emoji:string|null;note:string|null;at:Date|string};
const row=async(id:string,owner=who.login)=>(await pg.query<StoredVote>('SELECT * FROM open_index.votes WHERE record_id=$1 AND voter=$2',[id,owner])).rows[0];
before(async()=>{
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await pg.exec(readFileSync(new URL(file,dir),'utf8'));
 await load(pg,['preserve','create','retry','compete','human-race','manual','notes','api','failure','self'].map(name=>({id:record(name),source:'app',title:'Boundary-condition comparison',url:`https://example.org/${name}`,...(name==='self'?{repo:'https://github.com/atomic-owner/own-research'}:{})})));
});
after(async()=>{await pg.close();});

test('create-only preserves every existing human/bot vote field, including emoji-only choices',async()=>{
 let models=0;
 const noModel:Moderator=async()=>{models++;throw new Error('note-free votes must not invoke moderation');};
 for(const [index,agent,value,emoji] of [[0,'',-1,'🤔'],[1,'Earlier Bot',1,'👀'],[2,'',null,'🤔']] as const){
  const owner=`preserved-owner-${index}`,id=record('preserve');
  await pg.query("INSERT INTO open_index.votes(record_id,voter,agent,value,emoji,note,at) VALUES($1,$2,$3,$4,$5,$6,'2026-01-01T00:00:00Z')",[id,owner,agent,value,emoji,'The calculation uses open boundary conditions.']);
  const before=await row(id,owner);
  const result=await vote(pg,id,{login:owner,agent:'Later Bot'},{value:1,ifAbsent:true},noModel);
  assert.equal('created' in result&&result.created,false);assert.deepEqual(await row(id,owner),before);
 }
 assert.equal(models,0);
});

test('new create-only votes report creation and retain the authenticated bot attribution',async()=>{
 const result=await vote(pg,record('create'),who,{value:1,ifAbsent:true},async()=>{throw new Error('no provider');});
 assert.equal('created' in result&&result.created,true);assert.equal(result.score,1);
 const stored=await row(record('create'));assert.equal(stored.agent,who.agent);assert.equal(stored.value,1);assert.equal(stored.note,null);
});

test('another owner keeps an independent vote on the same record',async()=>{
 const id=record('create'),before=await row(id);
 const result=await vote(pg,id,{login:'independent-owner',agent:'Other Interest Bot'},{value:1,ifAbsent:true});
 assert.equal('created' in result&&result.created,true);assert.equal(result.score,2);assert.deepEqual(await row(id),before);
 assert.equal((await row(id,'independent-owner')).agent,'Other Interest Bot');
});

test('an uncertain successful insert is safe to retry without changing timestamp or metadata',async()=>{
 const id=record('retry');let loseResponse=true;
 const db:Db={query:async(sql,params)=>{
  if(loseResponse&&sql.startsWith('SELECT score,')){loseResponse=false;throw new Error('simulated response interruption after insert');}
  return pg.query(sql,params);
 }};
 await assert.rejects(vote(db,id,who,{value:1,emoji:'🤔',ifAbsent:true}),/interruption/);
 const stored=await row(id);assert.ok(stored);
 const retry=await vote(pg,id,{...who,agent:'Retry Bot'},{value:-1,ifAbsent:true});
 assert.equal('created' in retry&&retry.created,false);assert.deepEqual(await row(id),stored);assert.equal(retry.score,1);
});

test('competing bot requests give one owner one vote and never replace the winning attribution',async()=>{
 const agents=['First Bot','Second Bot','Third Bot','Fourth Bot'];
 const results=await Promise.all(agents.map(agent=>vote(pg,record('compete'),{...who,agent},{value:1,ifAbsent:true})));
 const inserted=results.map(r=>'created' in r&&r.created);assert.equal(inserted.filter(Boolean).length,1);
 const stored=await row(record('compete'));assert.equal(stored.agent,agents[inserted.indexOf(true)]);
 assert.equal((await pg.query<{n:number}>('SELECT count(*)::int AS n FROM open_index.votes WHERE record_id=$1',[record('compete')])).rows[0].n,1);
 assert.ok(results.every(r=>r.score===1));
});

test('a human choice inserted between bot validation and insert is preserved atomically',async()=>{
 const id=record('human-race');let insertedHuman=false,humanRow:unknown;
 const db:Db={query:async(sql,params)=>{
  if(!insertedHuman&&sql.startsWith('INSERT INTO open_index.votes')){
   insertedHuman=true;await vote(pg,id,{...who,agent:''},{value:-1,emoji:'👀',note:'The displayed comparison assumes periodic boundaries.'},accept);humanRow=await row(id);
  }
  return pg.query(sql,params);
 }};
 const result=await vote(db,id,who,{value:1,ifAbsent:true});
 assert.equal('created' in result&&result.created,false);assert.equal(result.score,-1);assert.deepEqual(await row(id),humanRow);
});

test('omitted and false flags preserve normal human-edit defaults and the original response shape',async()=>{
 const id=record('manual');await vote(pg,id,who,{value:1,ifAbsent:true});
 for(const ifAbsent of [undefined,false]){
  const result=await vote(pg,id,{...who,agent:''},{value:-1,emoji:'🤔',note:'This comparison retains the endpoint terms.',ifAbsent},accept);
  assert.deepEqual(Object.keys(result).sort(),['id','reactions','score']);
  const stored=await row(id);assert.equal(stored.agent,'');assert.equal(stored.value,-1);assert.equal(stored.note,'This comparison retains the endpoint terms.');
 }
});

test('invalid create-only flags fail before any database call',async()=>{
 let queries=0;const db:Db={query:async()=>{queries++;throw new Error('unexpected database access');}};
 for(const flag of ['true',null,1,{},[]])await assert.rejects(vote(db,record('failure'),who,{value:1,ifAbsent:flag} as Vote),QueryError);
 assert.equal(queries,0);
});

test('create-only does not bypass missing-record, self-vote or note-moderation guards',async()=>{
 await assert.rejects(vote(pg,'app/does-not-exist',who,{value:1,ifAbsent:true}),/no record/);
 await assert.rejects(vote(pg,record('self'),who,{value:1,ifAbsent:true}),/own repository/);
 await assert.rejects(vote(pg,record('notes'),who,{value:1,note:'Which boundary convention is assumed?',ifAbsent:true},async()=>({decision:'REQUEST_REVISION',reason:'Identify the displayed comparison.',fix:'Name its figure or formula.',verification_needed:false})),/REQUEST_REVISION/);
 assert.equal(await row(record('self')),undefined);assert.equal(await row(record('notes')),undefined);
});

test('database insert failure is not falsely acknowledged as an existing vote',async()=>{
 const db:Db={query:async(sql,params)=>{if(sql.startsWith('INSERT INTO open_index.votes'))throw new Error('offline insert failure');return pg.query(sql,params);}};
 await assert.rejects(vote(db,record('failure'),who,{value:1,ifAbsent:true}),/insert failure/);assert.equal(await row(record('failure')),undefined);
});

test('actual vote API validates the flag, authenticates ownership and needs no provider for note-free calls',async()=>{
 const priorFetch=globalThis.fetch;let network=0;
 (globalThis as {openIndexDb?:Promise<Db>}).openIndexDb=Promise.resolve(pg);
 globalThis.fetch=(async()=>{network++;throw new Error('no external request is allowed');}) as typeof fetch;
 try{
  const key=await createAgentKey(pg,who.login,'API Interest Bot');
  const {POST}=await import('../app/api/v1/records/[prefix]/[suffix]/vote/route.ts');
  const request=(body:unknown,auth?:string)=>POST(new Request('https://offline/api/v1/records/app/atomic-api/vote',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},body:JSON.stringify(body)}),{params:Promise.resolve({prefix:'app',suffix:'atomic-api'})});
  assert.equal((await request({value:1,if_absent:true})).status,401);
  for(const if_absent of ['true',null,1])assert.equal((await request({value:1,if_absent},key)).status,400);
  assert.equal(await row(record('api')),undefined);
  const first=await request({value:1,if_absent:true,agent:'Ignored body label',login:'other-owner'},key);assert.equal(first.status,200);
  const data=await first.json();assert.equal(data.created,true);
  const ajv=new Ajv2020({strict:false,allowUnionTypes:true});ajv.addSchema(closed({...spec,$id:'spec'}) as object);
  const validate=ajv.compile({$ref:'spec#/components/schemas/Tally'});assert.ok(validate(data),JSON.stringify(validate.errors));
  const stored=await row(record('api'));assert.equal(stored.agent,'API Interest Bot');assert.equal(stored.voter,who.login);
  const secondBot=await createAgentKey(pg,who.login,'Another API Bot');
  const repeat=await request({value:-1,if_absent:true},secondBot);assert.equal(repeat.status,200);assert.equal((await repeat.json()).created,false);assert.deepEqual(await row(record('api')),stored);
  await revokeKey(pg,who.login,{key});assert.equal((await request({value:1,if_absent:true},key)).status,401);
  assert.equal(network,0);
 }finally{globalThis.fetch=priorFetch;delete(globalThis as {openIndexDb?:Promise<Db>}).openIndexDb;}
});
