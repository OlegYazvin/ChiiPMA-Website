// Synthetic LOCAL regression check. Use fresh isolated D1 stores on :8797/:8798.
// Never target a hosted event: this intentionally changes draft attendance.
import assert from 'node:assert/strict';
import {normalizeRoster,generateFast,participants} from '../lib/matching.mjs';
import {reserveQrPeople} from '../lib/qr-slots.mjs';
const admin='http://127.0.0.1:8797',results='http://127.0.0.1:8798';
async function api(base,path,body,headers={}){
 const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...body?{'Content-Type':'application/json'}:{},...headers},body:body?JSON.stringify(body):undefined});
 return {status:response.status,data:await response.json()};
}
assert.equal((await api(admin,'state')).data.version,0,'Use a fresh LOCAL organizer store.');
assert.equal((await api(results,'state')).data.version,0,'Use a fresh LOCAL results store.');
const base=normalizeRoster(Array.from({length:28},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<14,isStudent:i<14,level:'Senior',jobs:[],employmentStatus:'Employed',included:true})));
const roster=normalizeRoster(reserveQrPeople(base)),schedule=generateFast(roster,27);
let response=await api(admin,'initialize',{roster,schedule});assert.equal(response.status,200,JSON.stringify(response.data));let state=response.data;
response=await api(admin,'qr-reservations',{expectedVersion:state.version});assert.equal(response.status,200);state=response.data;
const originalReservations=(await api(admin,'participant-admin?mode=real')).data.reservePages;
const questionBank=structuredClone(state.questionBank);
async function save(draft,schedule){
 const before=state,response=await api(admin,'save',{expectedVersion:state.version,roster:draft,...schedule?{schedule}:{}});
 assert.equal(response.status,200,JSON.stringify(response.data));state=response.data;
 assert.equal(state.version,before.version+1);assert.deepEqual(state.questionBank,questionBank);assert.equal(state.locked,false);assert.equal(state.live.currentRound,0);
 assert.deepEqual((await api(admin,'state')).data,state,'Saved roster must survive a fresh read from D1.');
 return state;
}
for(const selected of [0,6,15]){
 const draft=roster.map((p,i)=>({...p,included:i<selected}));assert.throws(()=>participants(draft));
 await save(draft);assert.equal(state.schedule,null);assert.equal(state.roster.filter(p=>p.included).length,selected);
}
const ineligible=roster.map(p=>({...p,teamId:'same-team'}));assert.throws(()=>participants(ineligible));await save(ineligible);assert.equal(state.schedule,null);
const invalidSchedule=await api(admin,'save',{expectedVersion:state.version,roster:state.roster,schedule});assert.equal(invalidSchedule.status,400);assert.equal((await api(admin,'state')).data.version,state.version);
const oddDraft=roster.map((p,i)=>({...p,included:i<15}));await save(oddDraft);
response=await api(admin,'candidates',{expectedVersion:state.version,attendee:{id:'synthetic-arrival',name:'Synthetic Arrival',level:null,jobs:[],employmentStatus:null,included:true}});
assert.equal(response.status,200,JSON.stringify(response.data));state=response.data;
const arrival=state.roster.find(p=>p.name==='Synthetic Arrival');assert.equal(arrival.included,false);assert.equal(arrival.qrSlot,1);assert.equal(arrival.id,'qr-person-1');
assert.equal(state.roster.filter(p=>p.included).length,15);assert.equal(state.schedule,null);
const reservations=(await api(admin,'participant-admin?mode=real')).data.reservePages;
for(const old of originalReservations){assert.equal(reservations.find(p=>p.slot===old.slot).url,old.url,'Printed QR identity must not change.');}
for(const [body,expected] of [
 [{expectedVersion:state.version-1,roster:state.roster},409],
 [{expectedVersion:state.version,roster:state.roster.filter(p=>p.id!=='qr-person-1')},400],
 [{expectedVersion:state.version,roster:state.roster.map((p,i)=>i===0?{...p,name:''}:p)},400],
 [{expectedVersion:state.version,roster:state.roster,schedule},400],
]){assert.equal((await api(admin,'save',body)).status,expected);assert.equal((await api(admin,'state')).data.version,state.version);}
assert.equal((await api(admin,'save',{expectedVersion:state.version,roster:state.roster},{Origin:'https://untrusted.example'})).status,403);
// Generation still requires a valid pool and a complete twelve-round schedule.
await save(state.roster.map(p=>({...p,included:!p.qrSlot,teamId:''})),schedule);assert.equal(state.schedule.rounds.length,12);
response=await api(admin,'control',{expectedVersion:state.version,action:'startTest'});assert.equal(response.status,200,JSON.stringify(response.data));state=response.data;assert.equal(state.locked,true);
assert.equal((await api(admin,'save',{expectedVersion:state.version,roster:state.roster})).status,409);
response=await api(admin,'control',{expectedVersion:state.version,action:'resetTest'});assert.equal(response.status,200);state=response.data;
// Leave a partial waiting roster for browser save-and-refresh verification.
await save(state.roster.map((p,i)=>({...p,included:i<3})));assert.equal(state.schedule,null);
const publicState=(await api(results,'state')).data;assert.equal(publicState.currentRound,0);assert.deepEqual(publicState.rounds,[]);
console.log('Passed: partial/empty/odd/ineligible attendance persists; old schedule clears; unchecked arrivals preserve printed QR codes; invalid schedules, stale writes, cross-origin writes, QR removal and frozen edits stay blocked.');
