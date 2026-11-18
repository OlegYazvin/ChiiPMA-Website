import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('../speed-networking-event/participant/index.html',import.meta.url),'utf8'),script=readFileSync(new URL('../speed-networking-event/participant/participant.js',import.meta.url),'utf8');
const sample=()=>({name:'Synthetic Person',isTest:false,status:'live',completedThroughRound:1,profile:{version:0,contacts:{linkedin:'',email:'',phone:'',other:''}},rounds:[{number:1,station:1,partner:'Synthetic Partner',leadQuestion:'Synthetic question?',response:null,mutual:false,contacts:null}]});
const flush=()=>new Promise(r=>setImmediate(r));
async function page(){
 const server=sample(),requests=[],fields=Object.fromEntries(['linkedin','email','phone','other'].map(name=>[name,{name,value:''}])),nodes=new Map(),listeners=new Map(),windowListeners=new Map();let closeOnSave=false,copied='',reloaded=false;
 for(const match of html.matchAll(/id="([^"]+)"/g))nodes.set('#'+match[1],{hidden:false,textContent:'',innerHTML:'',value:'',classList:{toggle(){}},addEventListener(type,cb){listeners.set(type,cb);},select(){}});
 nodes.get('#contact-form').elements={namedItem:name=>fields[name],*[Symbol.iterator](){yield* Object.values(fields);}};
 const context=vm.createContext({document:{querySelector:s=>{assert(nodes.has(s),s);return nodes.get(s);}},location:{hash:'#'+'A'.repeat(43),href:'https://chipma.org/speed-networking-event/participant/#'+'A'.repeat(43),reload(){reloaded=true;}},addEventListener:(type,callback)=>windowListeners.set(type,callback),navigator:{clipboard:{async writeText(value){copied=value;}}},AbortSignal,setTimeout(){},FormData:class{constructor(form){this.form=form;}*[Symbol.iterator](){for(const field of this.form.elements)yield [field.name,field.value];}},fetch:async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):null;if(body)requests.push({url,body});
  if(body&&url.endsWith('/contact')){if(closeOnSave)return {ok:false,status:410,json:async()=>({error:'These participant pages are closed.'})};server.profile={version:server.profile.version+1,contacts:body.contacts};}
  if(body&&url.includes('/rounds/')){const r=server.rounds.find(r=>url.endsWith('/'+r.number));r.response={...body,submittedAt:'2026-11-19T18:00:00Z'};}
  return {ok:true,json:async()=>structuredClone(server)};
 }});
 vm.runInContext(script,context);await flush();
 const target=(name,value,round=1)=>({name,value,closest:()=>({dataset:{round:String(round)}})});
 return {server,requests,fields,get:s=>nodes.get(s),change(name,value,round){listeners.get('change')({target:target(name,value,round)});},async submit(round=1){await listeners.get('submit')({preventDefault(){},target:target('','',round)});},async save(){await nodes.get('#contact-form').onsubmit({preventDefault(){}});},poll:()=>context.poll(),closeOnSave(){closeOnSave=true;},get copied(){return copied;},switchLink(){windowListeners.get('hashchange')();},get reloaded(){return reloaded;}};
}

test('ratings and stay-in-touch selections do not submit until the per-round Submit action',async()=>{
 const p=await page();assert.equal(p.fields.linkedin.value,'');p.change('rating','frown');p.change('stay','false');assert.equal(p.requests.length,0);await p.submit();assert.equal(p.requests.length,1);assert.deepEqual(p.requests[0].body,{rating:'frown',stayInTouch:false});assert(p.get('#conversation-cards').innerHTML.includes('Submitted:'));assert(!p.get('#conversation-cards').innerHTML.includes('class="response-form"'));await p.submit();assert.equal(p.requests.length,1);
});

test('Yes requires explicitly saved contacts, and contact edits are not autosaved',async()=>{
 const p=await page();p.change('rating','smile');p.change('stay','true');assert(p.get('#conversation-cards').innerHTML.includes('before submitting Yes'));assert.equal(p.requests.length,0);
 p.fields.email.value='person@example.test';p.get('#contact-form').oninput();await p.poll();assert.equal(p.fields.email.value,'person@example.test');assert.equal(p.requests.length,0);await p.save();assert.equal(p.requests.length,1);assert(p.requests[0].url.endsWith('/contact'));await p.submit();assert.equal(p.requests.length,2);assert.equal(p.requests[1].body.stayInTouch,true);
});

test('polling preserves unsent choices and appends completed rounds on the same page',async()=>{
 const p=await page();p.change('rating','neutral');p.change('stay','false');p.server.completedThroughRound=2;p.server.rounds.push({...p.server.rounds[0],number:2,partner:'Second Synthetic Partner'});await p.poll();const content=p.get('#conversation-cards').innerHTML;assert.match(content,/value="neutral"[^>]*checked/);assert(content.includes('Round 2'));assert(!content.includes('Round 3'));assert.equal(p.requests.length,0);
});

test('closing access removes displayed information and saving cannot reopen the closed page',async()=>{
 const p=await page();p.fields.email.value='person@example.test';p.get('#contact-form').oninput();p.closeOnSave();await p.save();assert.equal(p.get('#personal-content').hidden,true);assert.equal(p.get('#conversation-cards').innerHTML,'');assert.equal(p.fields.email.value,'');
});

test('Copy my link includes the private fragment for bookmarking and reuse',async()=>{
 const p=await page();await p.get('#copy-link').onclick();assert(p.copied.endsWith('#'+'A'.repeat(43)));
});

test('opening a different personal link reloads the app instead of retaining the previous identity',async()=>{
 const p=await page();p.switchLink();assert.equal(p.reloaded,true);
});
