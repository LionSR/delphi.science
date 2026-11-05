// Upgrade and data-safety verification only on explicitly isolated in-memory PostgreSQL.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {emptyDb,migrations,allowRouteImports,useDb} from '#lib/testing.ts';
import {load,type Item} from './load.ts';
import {canonicalWork,get,search} from './query.ts';
import {isGroupedWork} from './work-groups.ts';
import {comment} from '#lib/posts/comments.ts';
import {vote} from './votes.ts';
const migration=migrations().find(m=>m.name.includes('persistent_canonical_works'))!;
const main='lean/anthropics__formal-math__eth',paper='hexagon/2610.00577';
const accept=async()=>({decision:'ACCEPT' as const,reason:'Fixture',verification_needed:false});
const item=(id:string):Item=>({id,source:id.split('/')[0],title:'A similar title',url:`https://example.org/${id}`,published:'2026-01-01'});
const doiProof=(doi:string,zenodo?:string)=>({scheme:'doi' as const,value:doi,verified_by:zenodo?'zenodo-record' as const:'doi-csl' as const,evidence:zenodo?`https://zenodo.org/api/records/${zenodo}`:`https://doi.org/${doi.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)\s*/i,'').toLowerCase()}`});
async function legacy(){const db=emptyDb();for(const m of migrations().filter(m=>m.name!==migration.name))await db.exec(m.sql);return db;}
const apply=async(db:Awaited<ReturnType<typeof legacy>>)=>db.transaction(tx=>tx.exec(migration.sql));
const associate=(db:Awaited<ReturnType<typeof legacy>>,a:string,b:string,expected:string|null,title='Reviewed work',publication:string|null=a)=>db.query(
 'SELECT open_index.associate_work_source($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) AS id',[a,b,expected,'test-reviewer',JSON.stringify(['https://example.org/evidence']),title,'Paper','Paper publication',publication]);

test('upgrade backfills all sources, reuses legacy works and preserves raw data, votes, comments and archived versions',async()=>{
 const db=await legacy();try{
  await load(db,[item(main),item(paper),item('test/control')]);
  for(const [wid,id] of [['legacy-official',main],['legacy-paper',paper],['legacy-control','test/control']]){
   await db.query('INSERT INTO open_index.works(id,title) VALUES($1,$2)',[wid,'Legacy title']);
   await db.query('INSERT INTO open_index.work_records(work_id,record_id,relation) VALUES($1,$2,$3)',[wid,id,'original-relation']);
  }
  await db.query("INSERT INTO open_index.entries(id,entry) VALUES($1,$2)",['test/unbuilt',{source:'test',key:'unbuilt',url:'https://example.org/unbuilt',title:'Not built yet'}]);
  await db.query("UPDATE open_index.entries SET entry=entry||'{\"summary\":\"new version\"}',version=version+1 WHERE id='test/unbuilt'");
  for(const id of [main,paper]){await vote(db,id,{login:'reader',agent:''},{value:1},accept);await comment(db,id,{login:'reader',agent:''},{body:'Reviewed this source',review:true},accept);}
  const before={records:(await db.query('SELECT id,record,content_hash,added_at,updated_at FROM open_index.records ORDER BY id')).rows,
   entries:(await db.query('SELECT id,entry,version,updated_at FROM open_index.entries ORDER BY id')).rows,
   history:(await db.query('SELECT * FROM open_index.entry_history ORDER BY seq')).rows,
   votes:(await db.query('SELECT * FROM open_index.votes ORDER BY record_id')).rows,
   comments:(await db.query('SELECT * FROM open_index.comments ORDER BY id')).rows};
  await apply(db);
  assert.deepEqual((await db.query('SELECT id,record,content_hash,added_at,updated_at FROM open_index.records ORDER BY id')).rows,before.records);
  assert.deepEqual((await db.query('SELECT id,entry,version,updated_at FROM open_index.entries ORDER BY id')).rows,before.entries);
  assert.deepEqual((await db.query('SELECT * FROM open_index.entry_history ORDER BY seq')).rows,before.history);
  assert.deepEqual((await db.query('SELECT * FROM open_index.votes ORDER BY record_id')).rows,before.votes);
  assert.deepEqual((await db.query('SELECT * FROM open_index.comments ORDER BY id')).rows,before.comments);
  const r=(await get(db,paper))!;assert.equal(r.work_id,'legacy-official');assert.equal((r.work as any).main_record_id,main);
  assert.equal((await canonicalWork(db,'legacy-paper'))!.id,'legacy-official');
  assert.equal((await canonicalWork(db,'legacy-paper'))!.requested_work_id,'legacy-paper');
  assert.equal((await db.query<{work_id:string}>("SELECT work_id FROM open_index.entries WHERE id='test/unbuilt'")).rows[0].work_id,'test/unbuilt');
  const count=(await db.query('SELECT * FROM open_index.work_membership_history')).rows.length;
  await db.query('SELECT open_index.backfill_work_sources()');await db.query('SELECT open_index.backfill_work_sources()');
  assert.equal((await db.query('SELECT * FROM open_index.work_membership_history')).rows.length,count);
  assert.equal(await load(db,[item(main),item(paper),item('test/control')]),0,'unchanged-hash import cannot detach reviewed membership');
  const polluted={...(await get(db,paper))!,work_id:'false/work',work:{...((await get(db,paper))!.work as object),id:'false/work',main_record_id:'false/main'}} as unknown as Item;
  assert.equal(await load(db,[polluted]),1,'live counters differ from fixture; canonical input projection is ignored');
  assert.equal((await get(db,paper))!.work_id,'legacy-official');
  assert.equal((await get(db,'test/control'))!.work_id,'legacy-control','same title does not imply same work');
  assert.equal((await canonicalWork(db,'legacy-control'))!.title,'Legacy title','existing canonical titles are retained, not silently replaced by source metadata');
 }finally{await db.close();}
});

test('ambiguous legacy memberships, empty/multi-source works and singleton-ID collisions abort without discarding data',async()=>{
 for(const kind of ['duplicate','empty','ambiguous-main','collision']){
  const db=await legacy();try{
   await load(db,[item('test/a'),item('test/b')]);
   await db.query('INSERT INTO open_index.works(id,title) VALUES($1,$2)',[kind==='collision'?'test/a':'legacy','Keep me']);
   if(kind!=='empty')await db.query('INSERT INTO open_index.work_records(work_id,record_id) VALUES($1,$2)',[kind==='collision'?'test/a':'legacy',kind==='collision'?'test/b':'test/a']);
   if(kind==='duplicate'){await db.query("INSERT INTO open_index.works(id,title) VALUES('second','Second')");await db.query("INSERT INTO open_index.work_records VALUES('second','test/a','version')");}
   if(kind==='ambiguous-main')await db.query("INSERT INTO open_index.work_records VALUES('legacy','test/b','version')");
   const snapshot=(await db.query('SELECT * FROM open_index.work_records ORDER BY work_id,record_id')).rows;
   await assert.rejects(apply(db),/blocked|collision/);
   assert.deepEqual((await db.query('SELECT * FROM open_index.work_records ORDER BY work_id,record_id')).rows,snapshot,kind);
   assert.equal((await db.query<{exists:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='open_index.records'::regclass AND attname='work_id') AS exists")).rows[0].exists,false,'failed migration is atomic');
   assert.equal((await db.query('SELECT id FROM open_index.records')).rows.length,2);
  }finally{await db.close();}
 }
});

test('entries-first, records-only, reserved missing sources, refreshes and concurrent replays keep one persisted identity',async()=>{
 const db=await legacy();try{
  await apply(db);
  await db.query('INSERT INTO open_index.entries(id,entry) VALUES($1,$2)',[paper,{source:'hexagon',key:'2610.00577',title:'Paper',url:'https://example.org/paper'}]);
  assert.equal((await db.query<{work_id:string}>('SELECT work_id FROM open_index.entries WHERE id=$1',[paper])).rows[0].work_id,main);
  assert.equal(await get(db,main),null);assert.equal((await canonicalWork(db,main))!.main_record_id,main);
  await Promise.all([load(db,[item(paper)]),load(db,[item(paper)])]);
  assert.equal((await get(db,paper))!.work_id,main);
  await load(db,[{...item(main),title:'Source title refreshed'}]);
  assert.equal((await canonicalWork(db,main))!.title,'A 2^{o(n)} Time Algorithm for 3-SAT');
  await db.query('UPDATE open_index.records SET work_id=$1 WHERE id=$2',['wrong/work',paper]);
  assert.equal((await get(db,paper))!.work_id,main,'supplied projection cannot overwrite membership');
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int n FROM open_index.work_records WHERE record_id=$1',[paper])).rows[0].n,1);
  await assert.rejects(db.query('UPDATE open_index.records SET id=$1 WHERE id=$2',['hexagon/renamed',paper]),/immutable/);
  // Availability changes do not erase durable membership (existing interaction cascade behavior is unchanged).
  await db.query('DELETE FROM open_index.records WHERE id=$1',[paper]);await load(db,[item(paper)]);
  assert.equal((await get(db,paper))!.work_id,main);
 }finally{await db.close();}
});

test('new aliases resolve by verified exact DOI at insertion, before search/display, in either arrival order',async()=>{
 for(const reverse of [false,true]){
  const db=await legacy();try{
   await apply(db);
   const a={...item('doi/10.5281__ZENODO.8001'),identity:doiProof(' DOI:10.5281/ZENODO.8001 ')},b={...item('zenodo/8001'),identity:doiProof('https://doi.org/10.5281/zenodo.8001','8001')};
   const [first,second]=reverse?[b,a]:[a,b];
   // Records-only import and entry-first submission share the same trigger resolver.
   await load(db,[first]);
   await db.query('INSERT INTO open_index.entries(id,entry) VALUES($1,$2)',[second.id,{...second,key:second.id.split('/')[1],id:undefined}]);
   const rows=(await db.query<{work_id:string}>('SELECT work_id FROM open_index.work_records WHERE record_id=ANY($1::text[])',[ [a.id,b.id] ])).rows;
   assert.deepEqual(rows.map(r=>r.work_id),[first.id,first.id]);
   assert.equal((await db.query('SELECT id FROM open_index.works WHERE id=ANY($1::text[])',[[a.id,b.id]])).rows.length,1,'no second singleton is created, even transiently at transaction completion');
   assert.equal((await db.query('SELECT * FROM open_index.work_identifiers')).rows.length,1);
   await Promise.all([load(db,[a,b]),load(db,[b,a])]);
   await db.query('SELECT open_index.backfill_work_sources()');
   assert.equal((await db.query('SELECT DISTINCT work_id FROM open_index.records WHERE id=ANY($1::text[])',[[a.id,b.id]])).rows.length,1);
   assert.equal((await db.query<{main_record_id:string}>('SELECT main_record_id FROM open_index.works WHERE id=$1',[first.id])).rows[0].main_record_id,first.id,'main does not change with import/sort order after creation');
   await load(db,[item(second.id)]);
   assert.deepEqual((await canonicalWork(db,first.id))!.sources.find(s=>s.id===second.id)!.identity,second.identity,'accepted proof remains visible from persisted membership when a raw refresh omits it');
   await load(db,[{...item('doi/10.5281__zenodo.8002'),identity:doiProof('10.5281/zenodo.8002')}]);
   assert.equal((await db.query('SELECT * FROM open_index.work_identifiers')).rows.length,2,'different version DOI is distinct');
   await db.query('DELETE FROM open_index.records WHERE id=$1',[first.id]);
   const remaining=(await get(db,second.id))!;
   assert.ok(isGroupedWork(remaining));assert.equal((remaining.work as any).member_count,2);
   assert.equal((remaining.work as any).main_record_id,first.id,'automatic group still discloses fixed unavailable main');
   assert.equal((remaining.work as any).sources.length,1,'available source snapshots and durable membership are separate');
  }finally{await db.close();}
 }
});

test('identifier enrichment is conservative: conflicts, multiple/invalid proofs and relationship links never auto-merge',async()=>{
 const db=await legacy();try{
  await apply(db);
  const doi='10.5281/zenodo.9001',a='doi/10.5281__zenodo.9001',b='zenodo/9001';
  await load(db,[{...item(a),identity:doiProof(doi)},item(b)]);
  const before=(await db.query('SELECT id,record,content_hash,work_id FROM open_index.records ORDER BY id')).rows;
  await assert.rejects(load(db,[{...item(b),identity:doiProof(doi,'9001')}]),/conflicts with existing membership/);
  assert.deepEqual((await db.query('SELECT id,record,content_hash,work_id FROM open_index.records ORDER BY id')).rows,before);
  await load(db,[{...item('doi/10.5555__enriched'),doi:'10.5555/enriched'}]);
  await load(db,[{...item('doi/10.5555__enriched'),identity:doiProof('10.5555/enriched')}]);
  assert.equal((await db.query('SELECT * FROM open_index.work_identifiers WHERE doi=$1',['10.5555/enriched'])).rows.length,1,'late verified proof may enrich an otherwise unclaimed identity');
  for(const [id,proof] of [['zenodo/9002',doiProof(doi,'9002')],['web/false',doiProof(doi)],['doi/10.5555__bad',[doiProof(doi),doiProof('10.5555/other')]]]){
   await assert.rejects(db.query('INSERT INTO open_index.entries(id,entry) VALUES($1,$2)',[id,{title:'Unsafe claim',identity:proof}]),/identifier/);
   assert.equal((await db.query('SELECT * FROM open_index.work_records WHERE record_id=$1',[id])).rows.length,0);
  }
  await load(db,[{...item('test/reference'),doi,formalizes:[{identifier:doi,relationship:'formalizes'}]},item('test/same-title')]);
  assert.equal((await db.query('SELECT DISTINCT work_id FROM open_index.records WHERE id=ANY($1::text[])',[[a,b,'test/reference','test/same-title']])).rows.length,4,'plain DOI, title and formalizes relationship are not verified identity');
  await associate(db,a,b,b,'Reviewed DOI work');
  assert.equal((await db.query<{work_id:string}>('SELECT work_id FROM open_index.work_identifiers WHERE doi=$1',[doi])).rows[0].work_id,a);
  await load(db,[{...item(b),identity:doiProof(doi,'9001')}]);
  assert.equal((await db.query<{work_id:string}>('SELECT work_id FROM open_index.records WHERE id=$1',[b])).rows[0].work_id,a);
 }finally{await db.close();}
});

test('backfill prefers verified entry metadata over an older proof-less materialization without rewriting either',async()=>{
 const db=await legacy();try{
  const doi='10.5281/zenodo.8101',a='doi/10.5281__zenodo.8101',b='zenodo/8101';
  await load(db,[{...item(a),identity:doiProof(doi)},item(b)]);
  await db.query('INSERT INTO open_index.entries(id,entry) VALUES($1,$2)',[b,{title:'Refreshed source',identity:doiProof(doi,'8101')}]);
  const before=(await db.query('SELECT id,record,content_hash FROM open_index.records ORDER BY id')).rows;
  await apply(db);
  assert.equal((await db.query('SELECT DISTINCT work_id FROM open_index.work_records WHERE record_id=ANY($1::text[])',[[a,b]])).rows.length,1);
  assert.deepEqual((await db.query('SELECT id,record,content_hash FROM open_index.records ORDER BY id')).rows,before);
  await db.query('SELECT open_index.backfill_work_sources()');
  assert.equal((await db.query('SELECT * FROM open_index.work_identifiers WHERE doi=$1',[doi])).rows.length,1);
 }finally{await db.close();}
});

test('reviewed association is generic, transactional, idempotent and rejects stale/null CAS, false merges and invalid graph changes',async()=>{
 const db=await legacy();try{
  await apply(db);await load(db,[item('test/a'),item('test/b'),item('test/c')]);
  await assert.rejects(associate(db,'test/a','test/b',null),/required/);
  await assert.rejects(associate(db,'test/a','test/b','wrong/work'),/Stale/);
  await db.exec("UPDATE open_index.works SET title='Original target title' WHERE id='test/a'; UPDATE open_index.works SET title='Original source title' WHERE id='test/b'");
  const rawBefore=(await db.query('SELECT id,record,content_hash FROM open_index.records ORDER BY id')).rows;
  await associate(db,'test/a','test/b','test/b');
  type Audit={previous_work_id:string;work_id:string;previous_source_work:Record<string,unknown>;previous_target_work:Record<string,unknown>;source_work:Record<string,unknown>;target_work:Record<string,unknown>};
  const attached=(await db.query<Audit>("SELECT * FROM open_index.work_membership_history WHERE record_id='test/b' ORDER BY seq DESC LIMIT 1")).rows[0];
  assert.equal(attached.previous_source_work.id,attached.previous_work_id);
  assert.equal(attached.previous_source_work.id,'test/b');assert.equal(attached.previous_source_work.title,'Original source title');
  assert.equal(attached.previous_target_work.id,attached.work_id);assert.equal(attached.previous_target_work.title,'Original target title');
  assert.equal(attached.source_work.id,'test/b');assert.equal(attached.source_work.redirect_work_id,'test/a');assert.equal(attached.source_work.main_record_id,null);
  assert.equal(attached.target_work.id,'test/a');assert.equal(attached.target_work.title,'Reviewed work');
  assert.ok('reviewed_at' in attached.previous_source_work && 'reviewed_at' in attached.previous_target_work && 'reviewed_at' in attached.source_work && 'reviewed_at' in attached.target_work);
  assert.deepEqual((await db.query('SELECT id,record,content_hash FROM open_index.records ORDER BY id')).rows,rawBefore);
  const snapshot=(await db.query('SELECT * FROM open_index.work_membership_history')).rows;
  await associate(db,'test/a','test/b','test/b');assert.deepEqual((await db.query('SELECT * FROM open_index.work_membership_history')).rows,snapshot);
  await assert.rejects(associate(db,'test/a','test/b','wrong/work','Unexpected title'),/Stale/);
  await assert.rejects(associate(db,'test/c','test/a','test/a'),/singleton/);
  await assert.rejects(db.transaction(async tx=>{await tx.query("UPDATE open_index.work_records SET work_id='test/c' WHERE work_id='test/a'");await tx.query("UPDATE open_index.records SET work_id='test/c' WHERE work_id='test/a'");await tx.query("UPDATE open_index.works SET main_record_id=NULL,publication_record_id=NULL,redirect_work_id='test/c' WHERE id='test/a'");}),/aliases|foreign key/);
  await assert.rejects(db.transaction(tx=>tx.query("UPDATE open_index.works SET main_record_id='test/c' WHERE id='test/a'")),/foreign key/);
  const count=(await db.query('SELECT * FROM open_index.work_membership_history')).rows.length;
  await associate(db,'test/a','test/b','test/a','Reviewed work','test/b');
  assert.equal((await db.query('SELECT * FROM open_index.work_membership_history')).rows.length,count+1,'publication-only reviewed changes are audited');
  const publication=(await db.query<Audit>("SELECT * FROM open_index.work_membership_history WHERE record_id='test/b' ORDER BY seq DESC LIMIT 1")).rows[0];
  assert.equal(publication.previous_work_id,'test/a');assert.equal(publication.work_id,'test/a');
  assert.deepEqual(publication.previous_source_work,publication.previous_target_work);
  assert.deepEqual(publication.source_work,publication.target_work);
  assert.equal(publication.previous_target_work.publication_record_id,'test/a');assert.equal(publication.target_work.publication_record_id,'test/b');
  assert.equal(publication.target_work.main_record_id,'test/a');
  const publicationSnapshot=(await db.query('SELECT * FROM open_index.work_membership_history ORDER BY seq')).rows;
  await associate(db,'test/a','test/b','test/a','Reviewed work','test/b');
  assert.deepEqual((await db.query('SELECT * FROM open_index.work_membership_history ORDER BY seq')).rows,publicationSnapshot,'same-target no-op replay does not emit timestamp-only audit rows');
  const work=await canonicalWork(db,'test/b');assert.equal(work!.id,'test/a');assert.equal(work!.publication_record_id,'test/b');
  assert.equal((await search(db,'source:test')).total,2,'no per-work code needed for new association');
 }finally{await db.close();}
});

test('private ACLs override default public/app grants while the ingestion service can use only required helpers',async()=>{
 const db=await legacy();try{
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA open_index TO service_role; GRANT ALL ON ALL TABLES IN SCHEMA open_index TO service_role; GRANT USAGE ON ALL SEQUENCES IN SCHEMA open_index TO service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA open_index GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA open_index GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA open_index GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;");
  await load(db,[item('test/legacy-source')]);
  await db.exec("INSERT INTO open_index.works(id,title) VALUES('test/legacy-collision','Legacy'); INSERT INTO open_index.work_records(work_id,record_id) VALUES('test/legacy-collision','test/legacy-source')");
  await apply(db);
  for(const role of ['anon','authenticated','service_role']){
   const p=(await db.query<{op:boolean;history:boolean;backfill:boolean}>("SELECT has_function_privilege($1,'open_index.associate_work_source(text,text,text,text,jsonb,text,text,text,text)','EXECUTE') op,has_table_privilege($1,'open_index.work_membership_history','SELECT') history,has_function_privilege($1,'open_index.backfill_work_sources()','EXECUTE') backfill",[role])).rows[0];
   assert.deepEqual(p,{op:false,history:false,backfill:false});
  }
  await db.exec('SET ROLE service_role');await load(db,[item('test/service-ingest')]);
  await load(db,[{...item('doi/10.5281__ZENODO.7001'),identity:doiProof('10.5281/zenodo.7001')},{...item('zenodo/7001'),identity:doiProof('10.5281/zenodo.7001','7001')}]);
  assert.equal((await db.query('SELECT DISTINCT work_id FROM open_index.records WHERE id=ANY($1::text[])',[['doi/10.5281__ZENODO.7001','zenodo/7001']])).rows.length,1,'service ingestion resolves accepted aliases');
  await load(db,[item('doi/10.5555__service-enriched')]);
  await load(db,[{...item('doi/10.5555__service-enriched'),identity:doiProof('10.5555/service-enriched')}]);
  assert.ok((await db.query<{identity:unknown}>("SELECT identity FROM open_index.work_records WHERE record_id='doi/10.5555__service-enriched'")).rows[0].identity,'late proof is durable under the ingestion role');
  await assert.rejects(db.query('INSERT INTO open_index.work_identifiers VALUES($1,$2,$3,$4)',['10.5555/spoof','test/service-ingest','test/service-ingest',doiProof('10.5555/spoof')]),/identifier/);
  await assert.rejects(db.transaction(async tx=>{
   await tx.query('INSERT INTO open_index.work_identifiers VALUES($1,$2,$3,$4)',['10.5555/backdoor',main,'doi/10.5555__backdoor',doiProof('10.5555/backdoor')]);
   await tx.query('INSERT INTO open_index.work_records(work_id,record_id,identity) VALUES($1,$2,$3)',[main,'doi/10.5555__backdoor',doiProof('10.5555/backdoor')]);
  }),/owner/,'ingestion cannot invent a new DOI claim to bypass reviewed membership');
  await assert.rejects(db.query('INSERT INTO open_index.work_records(work_id,record_id) VALUES($1,$2)',[main,'test/backdoor']),/owner/);
  await assert.rejects(db.query("INSERT INTO open_index.work_records(work_id,record_id) VALUES('test/legacy-collision','test/legacy-collision')"),/owner/);
  await db.exec('RESET ROLE');
  assert.equal((await get(db,'test/service-ingest'))!.work_id,'test/service-ingest');
  assert.ok((await db.query<{relrowsecurity:boolean}>("SELECT relrowsecurity FROM pg_class WHERE oid='open_index.work_membership_history'::regclass")).rows[0].relrowsecurity);
  assert.equal((await db.query<{n:number}>("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='open_index'::regnamespace AND proname IN ('normalized_doi','source_doi','resolve_work_source','guard_work_membership','bind_work_source','check_work_graph','associate_work_source','backfill_work_sources') AND prosecdef")).rows[0].n,0);
 }finally{await db.close();}
});

test('old production schema remains readable without inferred grouping, and canonical endpoint explicitly holds until migration',async()=>{
 const db=await legacy();try{
  await load(db,[item(main),item(paper)]);
  const before=await search(db,'');assert.equal(before.work_model,'source_records');assert.equal(before.total,2);
  assert.equal((await get(db,main))!.work,undefined);
  await assert.rejects(canonicalWork(db,main),/not enabled/);
  allowRouteImports();useDb(db);const {GET}=await import('../../app/api/v1/works/route.ts');
  assert.equal((await GET(new Request(`http://localhost/api/v1/works?id=${encodeURIComponent(main)}`))).status,503);
  await apply(db);
  assert.equal((await search(db,'')).total,1,'same runtime detects separately applied local test migration');
  const response=await GET(new Request(`http://localhost/api/v1/works?id=${encodeURIComponent(paper)}`));assert.equal(response.status,200);
  const work=await response.json();assert.equal(work.id,main);assert.equal(work.requested_work_id,paper);
 }finally{useDb();await db.close();}
});
