// Isolated local plan probe. Never opens DATABASE_URL or a live database.
import {migratedDb} from '#lib/testing.ts';
import {load} from '#lib/records/load.ts';
import {search} from '#lib/records/query.ts';
const db=await migratedDb();
try {
 await load(db,Array.from({length:5000},(_,i)=>({id:`arxiv/plan-${i}`,source:'arxiv',title:`Plan control ${i}`,url:`https://example.org/${i}`,published:'2026-10-01'})));
 await load(db,[{id:'lean/anthropics__formal-math__eth',source:'lean',title:'Source README title',url:'https://github.com/anthropics/formal-math/tree/main/eth',published:'2026-08-06'},
  {id:'hexagon/2610.00577',source:'hexagon',title:'Paper title',url:'https://hexagonmath.org/2610.00577v1',published:'2026-10-27'}]);
 await db.exec('ANALYZE open_index.records; ANALYZE open_index.work_records; ANALYZE open_index.works');
 const results=[];
 for(const q of ['source:lean','']){
  const queries:{sql:string;params:unknown[]}[]=[];
  const trace={query:async<T,>(sql:string,params:unknown[]=[])=>{if(sql.startsWith('WITH ')||sql.includes('count(DISTINCT'))queries.push({sql,params});return db.query<T>(sql,params);}};
  const found=await search(trace,q,{sort:'newest',limit:20});
  for(const {sql,params} of queries){const plan=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,params)).rows[0];results.push({query:q,total:found.total,sql,params,plan});}
 }
 const hydration=await db.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT m.record_id FROM open_index.work_records m JOIN open_index.records r ON r.id=m.record_id WHERE m.work_id=$1",['lean/anthropics__formal-math__eth']);
 const report={environment:'Isolated in-memory PGlite only; production latency and locks not measured',source_rows:5002,canonical_works:5001,queries:results,hydration:hydration.rows[0]};
 const indexes=new Set<string>();function walk(x:any){if(!x||typeof x!=='object')return;if(x['Index Name'])indexes.add(x['Index Name']);for(const v of Object.values(x))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
 walk(report);console.log(JSON.stringify({environment:report.environment,source_rows:5002,canonical_works:5001,indexes:[...indexes],queries:results.map((r:any)=>({query:r.query,total:r.total,execution_ms:r.plan['QUERY PLAN'][0]['Execution Time']}))},null,2));
} finally {await db.close();}
