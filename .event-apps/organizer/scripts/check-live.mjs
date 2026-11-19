// Local-only end-to-end exercise. Run against two fresh local databases.
import assert from 'node:assert/strict';
import {normalizeRoster,generateFast} from '../lib/matching.mjs';
import {alternatingBaseline} from '../lib/alternating-solver.mjs';
const organizer='http://127.0.0.1:8787',results='http://127.0.0.1:8788';
async function req(base,path,body,headers={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
const roster=normalizeRoster(Array.from({length:40},(_,i)=>({id:`test${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<20,isStudent:i<20,level:'Senior',jobs:i<20?['Student']:['Product Management'],employmentStatus:'Employed',included:true,studentPairAnchor:i===0,alternateStudentPartners:i===0})));
const schedule=alternatingBaseline(roster,20);
let r=await req(organizer,'/api/initialize',{roster,schedule});if(r.status===409)r=await req(organizer,'/api/state');assert.equal(r.status,200);let state=r.data;assert(!state.locked);
assert.equal(state.schedule.metrics.stationStays,220);assert.equal(state.schedule.metrics.studentPairs,6);assert.equal(state.schedule.metrics.nonStudentPairs,6);assert.equal(state.roster.find(a=>a.studentPairAnchor).alternateStudentPartners,true);
const allCross=generateFast(roster.map(a=>({...a,alternateStudentPartners:false})),20);
assert.equal((await req(organizer,'/api/save',{expectedVersion:state.version,roster,schedule:allCross})).status,400);
r=await req(results,'/api/state');assert.equal(r.data.currentRound,0);assert.equal(r.data.rounds.length,0);assert(!JSON.stringify(r.data).includes('Synthetic'));
assert.equal((await req(results,'/api/publish',{})).status,401);
assert.equal((await req(organizer,'/api/save',{expectedVersion:state.version,roster},{Origin:'https://untrusted.example'})).status,403);
assert.equal((await req(organizer,'/api/save',{expectedVersion:999,roster})).status,409);
// Rehearse the same public route, reset mid-run, edit again, and repeat through
// completion. Both reset paths must preserve the actual schedule and roster.
const scheduleId=state.schedule.id;
for(const complete of [false,true]){
 r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'startTest'});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;assert.equal(state.live.isTest,true);assert.equal(state.locked,true);
 r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'next'});assert.equal(r.status,200);state=r.data;
 r=await req(results,'/api/state');assert.equal(r.data.isTest,true);assert.equal(r.data.currentRound,2);
 if(complete){for(let n=3;n<=12;n++){r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'next'});assert.equal(r.status,200);state=r.data;}r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'finish'});assert.equal(r.status,200);state=r.data;}
 r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'resetTest'});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;assert.equal(state.locked,false);assert.equal(state.schedule.id,scheduleId);assert.deepEqual(state.roster,roster);
 r=await req(results,'/api/state');assert.equal(r.data.status,'waiting');assert.equal(r.data.isTest,false);assert.equal(r.data.currentRound,0);assert.deepEqual(r.data.rounds,[]);assert(!JSON.stringify(r.data).includes('Synthetic'));
 r=await req(organizer,'/api/save',{expectedVersion:state.version,roster,schedule:state.schedule});assert.equal(r.status,200);state=r.data;
}
r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'start'});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;
assert.equal(state.locked,true);assert.equal(state.live.currentRound,1);assert.equal(state.live.isTest,false);
assert.equal((await req(organizer,'/api/control',{expectedVersion:state.version,action:'resetTest'})).status,409);
assert.equal((await req(organizer,'/api/save',{expectedVersion:state.version,roster})).status,409);
const oldVersion=state.version;
r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'break'});assert.equal(r.status,200);state=r.data;assert.equal(state.live.status,'break');
assert.equal((await req(organizer,'/api/control',{expectedVersion:oldVersion,action:'next'})).status,409);
assert.equal((await req(organizer,'/api/control',{expectedVersion:state.version,action:'next'})).status,409);
r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'resume'});assert.equal(r.status,200);state=r.data;
for(let round=2;round<=12;round++){r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'next'});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;assert.equal(state.live.currentRound,round);assert.equal(state.live.rounds.length,round);}
r=await req(organizer,'/api/control',{expectedVersion:state.version,action:'finish'});assert.equal(r.status,200);assert.equal(r.data.live.status,'finished');
const publicResponse=await fetch(results+'/api/state');assert.equal(publicResponse.headers.get('access-control-allow-origin'),'*');const published=await publicResponse.json();
assert.equal(published.rounds.length,12);for(const forbidden of ['level','jobs','employmentStatus','currentPeopleLeader','isMpdStudent','roster','schedule','operationId'])assert(!JSON.stringify(published).includes(`"${forbidden}"`));
const studentNames=new Set(roster.filter(a=>a.isMpdStudent).map(a=>a.name));
for(const rd of published.rounds){assert.deepEqual(rd.matches.map(p=>p.station).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+1));assert.equal(rd.matches.filter(p=>p.names.every(n=>studentNames.has(n))).length,rd.number%2);assert.equal(rd.matches.filter(p=>p.names.every(n=>!studentNames.has(n))).length,rd.number%2);}
const html=await (await fetch(organizer+'/organizer.html')).text();assert(html.includes('Round studio'));assert(html.includes('/organizer.mjs'));
console.log('Passed: full 12-round host flow, immutable lock, stale-write rejection, break/resume, sequential release, and public whitelist.');
