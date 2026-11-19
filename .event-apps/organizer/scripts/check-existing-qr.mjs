// Synthetic LOCAL API check. Uses isolated .wrangler/existing-qr-e2e stores.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeRoster,generateFast} from '../lib/matching.mjs';
const admin='http://127.0.0.1:8797',results='http://127.0.0.1:8798';
async function request(base,path,body,token){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...body?{'Content-Type':'application/json'}:{},...token?{Authorization:'Bearer '+token}:{}},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
assert.equal((await request(admin,'live')).data.version,0,'Fresh LOCAL storage is required.');
let roster=normalizeRoster(Array.from({length:28},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<14,isStudent:i<14,level:'Senior',jobs:[],employmentStatus:'Employed',included:true})));
roster=normalizeRoster([...roster,{...roster[14],id:'existing-unchecked',name:'Existing Synthetic Nonparticipant',included:false}]);
let response=await request(admin,'initialize',{roster,schedule:generateFast(roster,17)});assert.equal(response.status,200);let state=response.data;
async function post(path,body){const r=await request(admin,path,{expectedVersion:state.version,...body});assert.equal(r.status,200,JSON.stringify(r.data));assert(!r.data.qrSyncWarning);if(path!=='participant-admin')state=r.data;return r.data;}
await post('participant-admin',{action:'sync',mode:'real'});await post('qr-reservations',{});
const before=(await request(admin,'participant-admin?mode=real')).data,original=structuredClone(state),cards=before.reservePages;
await post('qr-assignment',{slot:1,attendeeId:'existing-unchecked'});
for(const key of ['roster','schedule','locked','live','questionBank'])assert.deepEqual(state[key],original[key]);
const spare=cards[0].url.split('#')[1];assert.equal((await request(results,'participant',null,spare)).data.name,'Existing Synthetic Nonparticipant');
assert.equal((await request(results,'participant/contact',{expectedVersion:0,contacts:{email:'existing@example.test'}},spare)).status,200);
assert.equal((await request(admin,'qr-assignment',{expectedVersion:original.version,slot:2,attendeeId:'synthetic-0'})).status,409);
for(const body of [{slot:1,attendeeId:'synthetic-0'},{slot:2,attendeeId:'existing-unchecked'},{slot:2,attendeeId:'missing'}])assert.equal((await request(admin,'qr-assignment',{expectedVersion:state.version,...body})).status,400);
await post('candidates',{attendee:{id:'new-person',name:'New Synthetic Person',isMpdStudent:false,isStudent:false,level:null,jobs:[],employmentStatus:null}});
assert.equal(state.roster.find(a=>a.name==='New Synthetic Person').id,'qr-person-2');
await post('qr-assignment',{slot:3,attendeeId:'synthetic-0'});
let pages=(await request(admin,'participant-admin?mode=real')).data;assert.deepEqual(pages.participants,before.participants);assert.deepEqual(pages.reservePages.map(a=>a.url),cards.map(a=>a.url));
await post('control',{action:'startTest'});await post('control',{action:'resetTest'});assert.equal((await request(results,'participant',null,spare)).data.profile.contacts.email,'existing@example.test');
roster=state.roster.map(a=>({...a,included:a.id==='existing-unchecked'?true:a.id==='synthetic-14'?false:a.included}));
await post('save',{roster,schedule:generateFast(roster,19)});await post('control',{action:'start'});
const live=(await request(admin,'live')).data;
response=await request(admin,'timer/start',{expectedVersion:state.version,expectedPublicVersion:live.version,runId:live.runId,round:1,timerVersion:live.timer.version});assert.equal(response.status,200);
const checkout=fileURLToPath(new URL('../../networking-results/',import.meta.url));
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/existing-qr-e2e','--command',"UPDATE round_timers SET deadline_at=1 WHERE status='running'"],{cwd:checkout,stdio:'ignore'});
const personal=(await request(results,'participant',null,spare)).data;assert.equal(personal.rounds.length,1);assert.equal(personal.profile.contacts.email,'existing@example.test');
assert.equal((await request(results,'participant/rounds/1',{rating:'smile',stayInTouch:false},spare)).status,200);
pages=(await request(admin,'participant-admin?mode=real')).data;const normal=pages.participants.find(a=>a.id==='existing-unchecked').url.split('#')[1];
assert.equal((await request(results,'participant',null,normal)).data.rounds[0].response.rating,'smile');assert.equal(pages.responses[0].name,'Existing Synthetic Nonparticipant');
const feed=JSON.stringify((await request(results,'state')).data);for(const value of [spare,'existing@example.test','qrAssignments'])assert(!feed.includes(value));
await post('participant-admin',{action:'access',open:false});assert.equal((await request(results,'participant',null,spare)).status,410);
console.log('Passed local HTTP flow: existing unchecked and participating attendees, stable spare codes, new arrivals skip assigned cards, unchanged matches, version conflicts, rehearsal isolation, shared profiles and final feedback, access closure.');
