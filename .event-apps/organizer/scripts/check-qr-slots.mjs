// Synthetic local HTTP check. Never targets production. Both services use
// fresh .wrangler/qr-slots-e2e stores at organizer :8797 and results :8798.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeRoster,generateFast} from '../lib/matching.mjs';
const admin='http://127.0.0.1:8797',results='http://127.0.0.1:8798';
async function request(base,path,body,token){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...body?{'Content-Type':'application/json'}:{},...token?{Authorization:'Bearer '+token}:{}},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
let response=await request(admin,'live');assert.equal(response.data.version,0,'Fresh LOCAL results storage is required.');
let roster=normalizeRoster(Array.from({length:40},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<20,isStudent:i<20,level:'Senior',jobs:[],employmentStatus:'Employed',included:true})));
response=await request(admin,'initialize',{roster,schedule:generateFast(roster,17)});assert.equal(response.status,200);let state=response.data;
async function post(path,body){const r=await request(admin,path,{expectedVersion:state.version,...body});assert.equal(r.status,200,JSON.stringify(r.data));assert(!r.data.qrSyncWarning);if(path!=='participant-admin')state=r.data;return r.data;}
await post('participant-admin',{action:'sync',mode:'real'});const original=(await request(admin,'participant-admin?mode=real')).data.participants;
const oldSchedule=structuredClone(state.schedule);await post('qr-reservations',{});assert.equal(state.roster.length,43);assert.deepEqual(state.schedule,oldSchedule);
let pages=(await request(admin,'participant-admin?mode=real')).data;const cards=pages.reservePages;assert.equal(cards.length,3);assert.deepEqual(pages.participants,original);
const tokens=cards.map(c=>c.url.split('#')[1]);for(const token of tokens){const p=await request(results,'participant',null,token);assert.equal(p.data.reservationPending,true);assert.equal((await request(results,'participant/contact',{expectedVersion:0,contacts:{}},token)).status,403);}
assert.equal((await request(admin,'candidates',{expectedVersion:state.version,attendee:{id:'duplicate',name:roster[0].name}})).status,400);
for(let n=1;n<=4;n++){
 await post('candidates',{attendee:{id:`new-${n}`,name:`New Attendee ${n}`,isMpdStudent:false,isStudent:false,level:null,jobs:[],employmentStatus:null,included:true}});
 assert.deepEqual(state.schedule,oldSchedule);const person=state.roster.find(a=>a.name===`New Attendee ${n}`);assert.equal(person.included,false);assert.equal(person.id,n<=3?`qr-person-${n}`:`new-${n}`);
 if(n<=3){const page=await request(results,'participant',null,tokens[n-1]);assert.equal(page.data.name,person.name);assert.equal(page.data.qrSlot,n);assert.deepEqual(page.data.rounds,[]);assert.equal((await request(results,'participant/contact',{expectedVersion:0,contacts:{email:`slot-${n}@example.test`}},tokens[n-1])).status,200);}
}
pages=(await request(admin,'participant-admin?mode=real')).data;assert.deepEqual(pages.reservePages.map(p=>p.url),cards.map(p=>p.url));assert.deepEqual(pages.participants,original);const version=state.version;await post('qr-reservations',{});assert.equal(state.version,version);
assert.equal((await request(results,'manage/reservations')).status,401);
await post('control',{action:'startTest'});await post('control',{action:'resetTest'});assert.equal((await request(results,'participant',null,tokens[0])).data.profile.contacts.email,'slot-1@example.test');
roster=state.roster.map(a=>({...a,included:a.id==='qr-person-1'?true:a.id==='synthetic-20'?false:a.included}));await post('save',{roster,schedule:generateFast(roster,21)});await post('control',{action:'start'});
const live=(await request(admin,'live')).data;
response=await request(admin,'timer/start',{expectedVersion:state.version,expectedPublicVersion:live.version,runId:live.runId,round:live.currentRound,timerVersion:live.timer.version});assert.equal(response.status,200);
const checkout=fileURLToPath(new URL('../../networking-results/',import.meta.url));execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/qr-slots-e2e','--command',"UPDATE round_timers SET deadline_at=1 WHERE status='running'"],{cwd:checkout,stdio:'ignore'});
response=await request(results,'participant',null,tokens[0]);assert.equal(response.data.rounds.length,1);assert.equal(response.data.profile.contacts.email,'slot-1@example.test');assert.equal((await request(results,'participant/rounds/1',{rating:'smile',stayInTouch:false},tokens[0])).status,200);
assert.equal((await request(admin,'participant-admin?mode=real')).data.responses[0].name,'New Attendee 1');const feed=JSON.stringify((await request(results,'state')).data);for(const value of [...tokens,'slot-1@example.test','qr_reservations','roster_version'])assert(!feed.includes(value));
await post('participant-admin',{action:'access',open:false});assert.equal((await request(results,'participant',null,tokens[0])).status,410);await post('participant-admin',{action:'access',open:true});assert.equal((await request(results,'participant',null,tokens[0])).data.name,'New Attendee 1');
console.log('Passed local end-to-end: three stable QR reservations, pending-page safety, ordered future-attendee claims, unchanged existing links/matches, rehearsal isolation, real-round feedback, private contacts, and access closure.');
