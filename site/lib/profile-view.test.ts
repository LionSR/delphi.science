// Public activity presentation, using the actual server component and neutral contribution text.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileView } from './profile-view.ts';
import { PublicAuthor, profilePath } from './public-author.ts';
import type { ProfileActivity } from './profile.ts';
const at='2026-10-27T06:00:00Z';
const page:ProfileActivity={login:'ada',posts:[
 {id:2,kind:'reply',voter:'Ada',agent:'Boundary & Conditions',body:'For $x=0$, both terms vanish.',review:false,at,title:'Boundary conventions',topic_id:10,permalink:'/forum/10#p2'},
 {id:1,kind:'review',voter:'ada',agent:'',body:'Which boundary convention is assumed?',review:true,at,title:'Finite chains',record_id:'app/boundary',permalink:'/r/app/boundary#p1'},
],next_cursor:'opaque-cursor'};
test('profile renders public contributions with clear account/bot attribution and direct permalinks',()=>{
 const html=renderToStaticMarkup(createElement(ProfileView,{activity:page}));
 assert.match(html,/<h1[^>]*>@ada<\/h1>/);assert.match(html,/Boundary &amp; Conditions/);assert.match(html,/Bot post/);assert.match(html,/Account post/);
 assert.match(html,/href="\/forum\/10#p2"/);assert.match(html,/href="\/r\/app\/boundary#p1"/);assert.match(html,/mjx-container/);
 assert.match(html,/href="\/u\/ada\?cursor=opaque-cursor"/);assert.match(html,/Older posts/);
 assert.doesNotMatch(html,/agent_keys|key_id|avatar|biography|email|moderations/);
});
test('empty public activity does not claim an account exists or expose bot inventory',()=>{
 const html=renderToStaticMarkup(createElement(ProfileView,{activity:{login:'quiet-owner',posts:[],next_cursor:null}}));
 assert.match(html,/No public posts or comments/);assert.doesNotMatch(html,/Older posts|registered|unused|private|key/);
});
test('error view is actionable and shows no partial posts or cursor',()=>{
 const html=renderToStaticMarkup(createElement(ProfileView,{activity:{...page,posts:[],next_cursor:null},failed:true}));
 assert.match(html,/role="alert"/);assert.match(html,/temporarily unavailable/);assert.match(html,/Try again/);assert.doesNotMatch(html,/opaque-cursor|Boundary &amp; Conditions/);
});
test('public author links preserve existing attribution as escaped text and safe internal paths',()=>{
 const html=renderToStaticMarkup(createElement(PublicAuthor,{voter:'Ada',agent:'Boundary & Conditions'}));
 assert.match(html,/href="\/u\/Ada"/);assert.match(html,/@Ada<\/a> via Boundary &amp; Conditions/);
 assert.equal(profilePath('public notes?'),'\/u\/public%20notes%3F');
});
test('tabs show counts and mark the current one; votes list record votes with notes',()=>{
 const counts={topics:1,replies:2,comments:3,votes:1};
 const html=renderToStaticMarkup(createElement(ProfileView,{activity:page,counts,tab:'replies'}));
 assert.match(html,/href="\/u\/ada\?tab=replies" aria-current="page">Replies<span class="n"> 2<\/span>/);
 assert.match(html,/href="\/u\/ada">All<\/a>/);assert.match(html,/>Reply<\/span>/);assert.match(html,/>Review<\/span>/);
 assert.match(html,/href="\/u\/ada\?tab=replies&amp;cursor=opaque-cursor"/);
 const votes={login:'ada',votes:[{record_id:'app/boundary',title:'Finite chains',agent:'Daily picks',value:1 as const,emoji:null,note:'Matches my work on open chains.',at,permalink:'/r/app/boundary'}],next_cursor:null};
 const v=renderToStaticMarkup(createElement(ProfileView,{votes,counts,tab:'votes'}));
 assert.match(v,/▲ Up/);assert.match(v,/href="\/r\/app\/boundary">Finite chains/);assert.match(v,/@ada<\/a> via Daily picks/);assert.match(v,/Matches my work/);
 assert.match(v,/Forum post votes are not shown/);
});
