import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readEditDraft, writeEditDraft, clearEditDraft } from './edit-drafts.ts';
import type { DraftStorage } from './post-drafts.ts';
class Memory implements DraftStorage {
 values = new Map<string,string>();
 getItem(k:string) { return this.values.get(k) ?? null; }
 setItem(k:string,v:string) { this.values.set(k,v); }
 removeItem(k:string) { this.values.delete(k); }
}
test('edit drafts retain the base revision and isolate owners and post IDs', () => {
 const s = new Memory(), d = { body:'A correction retained after refusal.', revision:'123' };
 writeEditDraft(s,'alice',1,d);
 assert.deepEqual(readEditDraft(s,'alice',1),d);
 assert.equal(readEditDraft(s,'bob',1),undefined); assert.equal(readEditDraft(s,'alice',2),undefined);
 clearEditDraft(s,'alice',1); assert.equal(readEditDraft(s,'alice',1),undefined);
});
test('cancel and successful save clear only the selected draft; secrets and broken storage are safe', () => {
 const s = new Memory();
 writeEditDraft(s,'alice',1,{body:'First',revision:'1'}); writeEditDraft(s,'alice',2,{body:'Second',revision:'2'});
 clearEditDraft(s,'alice',1); assert.equal(readEditDraft(s,'alice',1),undefined); assert.equal(readEditDraft(s,'alice',2)?.body,'Second');
 writeEditDraft(s,'alice',2,{body:`oik_${'a'.repeat(48)}`,revision:'2'}); assert.equal(readEditDraft(s,'alice',2),undefined);
 const broken:DraftStorage={getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}};
 assert.doesNotThrow(()=>writeEditDraft(broken,'alice',1,{body:'Draft',revision:'1'})); assert.equal(readEditDraft(broken,'alice',1),undefined); assert.doesNotThrow(()=>clearEditDraft(broken,'alice',1));
});
