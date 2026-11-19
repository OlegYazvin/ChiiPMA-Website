// Local synthetic end-to-end check. Requires fresh local D1 stores at
// .wrangler/personal-pages-e2e, organizer :8797, and results :8798.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeRoster,generateFast} from '../lib/matching.mjs';
const admin='http://127.0.0.1:8797',results='http://127.0.0.1:8798';
async function request(base,path,body,token,origin){const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...body?{'Content-Type':'application/json'}:{},...token?{Authorization:'Bearer '+token}:{},...origin?{Origin:origin}:{}},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});return {status:response.status,data:await response.json()};}
let live=await request(admin,'live');assert.equal(live.status,200);assert.equal(live.data.version,0,'The organizer must target the fresh LOCAL results database before this test writes anything.');
const roster=normalizeRoster(Array.from({length:40},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<20,isStudent:i<20,level:'Senior',jobs:['Product Management'],employmentStatus:'Employed',included:true})));
let response=await request(admin,'state'),state=response.data;if(state.version===0){response=await request(admin,'initialize',{roster,schedule:generateFast(roster,19)});assert.equal(response.status,200);state=response.data;}else{assert(state.roster.every(p=>p.id.startsWith('synthetic-')));assert.equal(state.live.status,'waiting');}
async function action(action,extra={}){const r=await request(admin,'participant-admin',{expectedVersion:state.version,action,...extra});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function control(action){const r=await request(admin,'control',{expectedVersion:state.version,action});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;return state;}
const real=await action('sync',{mode:'real'});assert.equal(real.participants.length,40);const realToken=real.participants[0].url.split('#')[1];
response=await request(results,'participant/contact',{expectedVersion:0,contacts:{email:'real-profile@example.test'}},realToken);assert.equal(response.status,200);
await control('startTest');const rehearsal=(await request(admin,'participant-admin?mode=test')).data;assert.equal(rehearsal.participants.length,40);
const pair=state.live.rounds[0].matches[0],tokens=pair.names.map(name=>rehearsal.participants.find(p=>p.name===name).url.split('#')[1]);
response=await request(results,'participant',null,tokens[0]);assert.deepEqual(response.data.rounds,[]);
assert.equal((await request(results,'participant/rounds/1',{rating:'smile',stayInTouch:false},tokens[0])).status,403);
assert.equal((await request(results,'participant/contact',{expectedVersion:0,contacts:{}},tokens[0],'https://untrusted.example')).status,403);
const host=(await action('hostLink')).url.split('#host=')[1],before=(await request(results,'state')).data;
assert.equal((await request(results,'timer/start',{runId:before.runId,round:1,expectedVersion:0},tokens[0])).status,403);
response=await request(results,'timer/start',{runId:before.runId,round:1,expectedVersion:0},host);assert.equal(response.status,200);
assert.equal((await request(admin,'control',{expectedVersion:state.version,action:'next'})).status,409);assert.equal((await request(admin,'state')).data.pending,null);
// Advance ONLY the isolated local database clock; production has no shortcut.
const checkout=fileURLToPath(new URL('../../networking-results/',import.meta.url));
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/personal-pages-e2e','--command',"UPDATE round_timers SET deadline_at=1 WHERE status='running'"],{cwd:checkout,stdio:'ignore'});
for(let i=0;i<2;i++){response=await request(results,'participant/contact',{expectedVersion:0,contacts:{email:`test-${i}@example.test`}},tokens[i]);assert.equal(response.status,200);}
response=await request(results,'participant/rounds/1',{rating:'frown',stayInTouch:true},tokens[0]);assert.equal(response.status,200);assert.equal(response.data.rounds[0].contacts,null);
response=await request(results,'participant/rounds/1',{rating:'smile',stayInTouch:true},tokens[1]);assert.equal(response.status,200);assert.equal(response.data.rounds[0].contacts.email,'test-0@example.test');
response=await request(results,'participant',null,tokens[0]);assert.equal(response.data.rounds[0].contacts.email,'test-1@example.test');
assert.equal((await request(results,'participant/rounds/1',{rating:'neutral',stayInTouch:false},tokens[0])).status,409);
assert.equal((await request(results,'participant/rounds/2',{rating:'neutral',stayInTouch:false},tokens[0])).status,403);
assert.equal((await request(admin,'participant-admin?mode=test')).data.responses.length,2);assert.equal((await request(admin,'participant-admin?mode=real')).data.responses.length,0);
const publicData=JSON.stringify((await request(results,'state')).data);for(const value of [...tokens,'test-0@example.test','participant_id','token_hash','contactReady'])assert(!publicData.includes(value));
await control('next');assert.equal((await request(results,'participant',null,tokens[0])).data.rounds.length,1);await control('resetTest');
assert.equal((await request(results,'participant',null,tokens[0])).status,410);response=await request(results,'participant',null,realToken);assert.equal(response.data.profile.contacts.email,'real-profile@example.test');assert.deepEqual(response.data.rounds,[]);
await action('access',{open:false});assert.equal((await request(results,'participant',null,realToken)).status,410);await action('access',{open:true});
await control('start');const normal=(await request(results,'participant',null,realToken)).data;assert.equal(normal.isTest,false);assert.equal(normal.profile.contacts.email,'real-profile@example.test');assert.deepEqual(normal.rounds,[]);
console.log('Passed local end-to-end: private QR provisioning, explicit contacts, host-only shared timer, full-five-minute enforcement, final per-round submissions, mutual-only sharing, no future-data leaks, named admin feedback, test isolation, reset, and access closure.');
