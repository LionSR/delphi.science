// Public Q&A activity, not an account directory: only already-public contribution rows are read.
import { QueryError,type Db } from './query.ts';
import { recordPath } from './view.ts';
export const DEFAULT_PROFILE_LIMIT=20,MAX_PROFILE_LIMIT=50;
export type ProfilePost={id:number;voter:string;agent:string;body:string;review:boolean;at:string;title:string;record_id?:string;topic_id?:number;parent?:number;permalink:string};
export type ProfileActivity={login:string;posts:ProfilePost[];next_cursor:string|null};
type Row={id:string;voter:string;agent:string;body:string;review:boolean;at:string|Date;title:string;record_id:string|null;topic_id:string|null;parent:string|null};
const badLogin=()=>new QueryError('Use a valid GitHub login.','Use 1–39 ASCII letters/digits or single internal hyphens; account paths and display names are not handles.');
const badCursor=()=>new QueryError('The public-activity cursor is invalid for this handle.','Pass this handle’s next_cursor unchanged, or start from its first page.');
const unavailable=()=>new QueryError('Public activity is temporarily unavailable.','Try this public activity page again later.');
export function normalizeProfileLogin(value:unknown):string{
 if(typeof value!=='string'||!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value)||value.includes('--'))throw badLogin();
 return value.toLowerCase();
}
const encode=(login:string,before:number)=>Buffer.from(JSON.stringify({v:1,login,before})).toString('base64url');
function decode(cursor:string|undefined|null,login:string):number|undefined{
 if(cursor===undefined||cursor===null)return;
 if(typeof cursor!=='string'||!cursor||cursor.length>256||!/^[a-z\d_-]+$/i.test(cursor))throw badCursor();
 try{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(cursor,'base64url'));
  const value=JSON.parse(text);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='before,login,v'||value.v!==1||value.login!==login||!Number.isSafeInteger(value.before)||value.before<1||encode(login,value.before)!==cursor)throw badCursor();
  return value.before;
 }catch{throw badCursor();}
}
function id(value:string|number):number{
 const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw unavailable();return n;
}
/** No account lookup/existence flag, private tables, counts, bot inventory or hidden relations. */
export async function profileActivity(db:Db,handle:unknown,options:{limit?:number;cursor?:string|null}={}):Promise<ProfileActivity>{
 const login=normalizeProfileLogin(handle),limit=options.limit??DEFAULT_PROFILE_LIMIT;
 if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_PROFILE_LIMIT)throw new QueryError(`Activity limit must be from 1 to ${MAX_PROFILE_LIMIT}.`,'Use a whole-number limit, or omit it for 20 public posts.');
 const before=decode(options.cursor,login);
 try{
  const rows=(await db.query<Row>(`SELECT c.id::text AS id,c.voter,c.agent,c.body,c.review,c.at,
    c.record_id,c.topic_id::text AS topic_id,c.parent_id::text AS parent,coalesce(r.title,t.title) AS title
   FROM open_index.comments c
   LEFT JOIN open_index.records r ON r.id=c.record_id AND NOT r.gone
   LEFT JOIN open_index.topics t ON t.id=c.topic_id
   LEFT JOIN open_index.comments p ON p.id=c.parent_id AND p.record_id IS NOT DISTINCT FROM c.record_id AND p.topic_id IS NOT DISTINCT FROM c.topic_id
   WHERE lower(c.voter)=$1 AND ($2::bigint IS NULL OR c.id<$2::bigint)
    AND ((c.record_id IS NOT NULL AND c.topic_id IS NULL AND r.id IS NOT NULL)
      OR (c.topic_id IS NOT NULL AND c.record_id IS NULL AND t.id IS NOT NULL
       AND EXISTS (SELECT 1 FROM open_index.comments q WHERE q.topic_id=c.topic_id AND q.parent_id IS NULL AND q.record_id IS NULL)))
    AND (c.parent_id IS NULL OR p.id IS NOT NULL)
   ORDER BY c.id DESC LIMIT $3`,[login,before??null,limit+1])).rows;
  const posts=rows.slice(0,limit).map((row):ProfilePost=>{
   const postId=id(row.id),topic=row.topic_id===null?undefined:id(row.topic_id),parent=row.parent===null?undefined:id(row.parent);
   const at=row.at instanceof Date?row.at:new Date(row.at);
   if(typeof row.voter!=='string'||row.voter.toLowerCase()!==login||typeof row.agent!=='string'||typeof row.body!=='string'||typeof row.title!=='string'||typeof row.review!=='boolean'||!Number.isFinite(at.getTime()))throw unavailable();
   return {id:postId,voter:row.voter,agent:row.agent,body:row.body,review:row.review,at:at.toISOString(),title:row.title,
    ...(row.record_id===null?{}:{record_id:row.record_id}),...(topic===undefined?{}:{topic_id:topic}),...(parent===undefined?{}:{parent}),
    permalink:row.record_id===null?`/forum/${topic}#p${postId}`:`${recordPath(row.record_id)}#p${postId}`};
  });
  return {login,posts,next_cursor:rows.length>limit?encode(login,posts.at(-1)!.id):null};
 }catch{throw unavailable();}
}
