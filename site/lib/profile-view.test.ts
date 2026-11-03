// Public activity presentation, using the actual server component and neutral contribution text.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProfileView } from './profile-view.ts';
import { PublicAuthor, profilePath } from './public-author.ts';
import type { Profile } from './profile.ts';
const at='2026-10-27T06:00:00Z';
const none={topics:0,replies:0,comments:0,votes:0};
const page:Profile={login:'ada',tab:'all',counts:none,posts:[
 {id:2,kind:'answer',voter:'Ada',agent:'Boundary & Conditions',body:'For $x=0$, both terms vanish.',at,title:'Boundary conventions',topic_id:10,permalink:'/forum/10#p2'},
 {id:1,kind:'review',voter:'ada',agent:'',body:'Which boundary convention is assumed?',at,title:'Finite chains',record_id:'app/boundary',permalink:'/r/app/boundary#p1'},
],next_cursor:'opaque-cursor'};
test('profile renders public contributions with clear account/bot attribution and direct permalinks',()=>{
 const html=renderToStaticMarkup(createElement(ProfileView,{login:'ada',page}));
 assert.match(html,/<h1[^>]*>@ada<\/h1>/);assert.match(html,/Boundary &amp; Conditions/);assert.match(html,/Bot post/);assert.match(html,/Account post/);
 assert.match(html,/href="\/forum\/10#p2"/);assert.match(html,/href="\/r\/app\/boundary#p1"/);assert.match(html,/mjx-container/);
 assert.match(html,/href="\/u\/ada\?cursor=opaque-cursor"/);assert.match(html,/Older posts/);
 assert.doesNotMatch(html,/agent_keys|key_id|avatar|biography|email|moderations/);
});
test('empty public activity does not claim an account exists or expose bot inventory',()=>{
 const html=renderToStaticMarkup(createElement(ProfileView,{login:'quiet-owner',page:{login:'quiet-owner',tab:'all',counts:none,posts:[],next_cursor:null}}));
 assert.match(html,/No public posts or comments/);assert.doesNotMatch(html,/Older posts|registered|unused|private|key/);
});
test('error view is actionable and shows no partial posts or cursor',()=>{
 const html=renderToStaticMarkup(createElement(ProfileView,{login:'ada',page:null}));
 assert.match(html,/role="alert"/);assert.match(html,/temporarily unavailable/);assert.match(html,/Try again/);assert.doesNotMatch(html,/opaque-cursor|Boundary &amp; Conditions/);
});
test('public author links preserve existing attribution as escaped text and safe internal paths',()=>{
 const html=renderToStaticMarkup(createElement(PublicAuthor,{voter:'Ada',agent:'Boundary & Conditions'}));
 assert.match(html,/href="\/u\/Ada"/);assert.match(html,/@Ada<\/a> via Boundary &amp; Conditions/);
 assert.equal(profilePath('public notes?'),'\/u\/public%20notes%3F');
});
test('tabs show counts and mark the current one; votes list record votes with notes',()=>{
 const counts={topics:1,replies:2,comments:3,votes:1};
 const html=renderToStaticMarkup(createElement(ProfileView,{login:'ada',page:{...page,counts,tab:'replies'},tab:'replies'}));
 assert.match(html,/href="\/u\/ada\?tab=replies" aria-current="page">Replies<span class="n"> 2<\/span>/);
 assert.match(html,/href="\/u\/ada">All<\/a>/);assert.match(html,/>Reply<\/span>/);assert.match(html,/>Review<\/span>/);
 assert.match(html,/href="\/u\/ada\?tab=replies&amp;cursor=opaque-cursor"/);
 const votes:Profile={login:'ada',tab:'votes',counts,votes:[{record_id:'app/boundary',title:'Finite chains',agent:'Daily picks',value:1 as const,emoji:null,note:'Matches my work on open chains.',at,permalink:'/r/app/boundary'}],next_cursor:null};
 const v=renderToStaticMarkup(createElement(ProfileView,{login:'ada',page:votes,tab:'votes'}));
 assert.match(v,/▲ Up/);assert.match(v,/href="\/r\/app\/boundary">Finite chains/);assert.match(v,/@ada<\/a> via Daily picks/);assert.match(v,/Matches my work/);
 assert.match(v,/Forum post votes are not shown/);
});

test('a known display name heads the profile and labels its posts, with the login kept beside it',()=>{
 const html=renderToStaticMarkup(createElement(ProfileView,{login:'ada',page,name:'Ada <Lovelace>'}));
 assert.match(html,/<h1>Ada &lt;Lovelace&gt;<\/h1><p class="meta tex2jax_ignore">@ada<\/p>/);
 assert.match(html,/>Ada &lt;Lovelace&gt; @Ada<\/a>/);
});
