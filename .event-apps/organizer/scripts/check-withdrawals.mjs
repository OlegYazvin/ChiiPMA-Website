// Synthetic local-only integration check. Requires fresh isolated D1 stores,
// organizer :8797 and results :8798, both using .wrangler/withdrawals-e2e.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeRoster,generateFast} from '../lib/matching.mjs';
const admin='http://127.0.0.1:8797',results='http://127.0.0.1:8798';
const resultsCheckout=process.env.SYNTHETIC_RESULTS_CHECKOUT||fileURLToPath(new URL('../../results/',import.meta.url));
async function request(base,path,body,token){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...body?{'Content-Type':'application/json'}:{},...token?{Authorization:'Bearer '+token}:{}},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});return {status:r.status,data:await r.json()};}
async function ok(base,path,body,token){const r=await request(base,path,body,token);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
function expireLocalTimer(){execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/withdrawals-e2e','--command',"UPDATE round_timers SET deadline_at=1 WHERE status='running'"],{cwd:resultsCheckout,stdio:'ignore'});}
const token=page=>page.url.split('#')[1];
assert.equal((await ok(results,'state')).version,0,'Refuse to touch anything except a fresh LOCAL results store.');
assert.equal((await ok(admin,'state')).version,0,'Refuse to touch anything except a fresh LOCAL admin store.');
const person=(id,name,isMpdStudent,included=true)=>({id,name,isMpdStudent,isStudent:isMpdStudent,studentPairGroup:isMpdStudent?'first_year':null,level:'Senior',jobs:['Product Management'],employmentStatus:'Employed',included});
const roster=normalizeRoster([...Array.from({length:26},(_,i)=>person(`synthetic-${i}`,`Synthetic Person ${i}`,i<13)),person('synthetic-late-student','Synthetic Late Student',true,false),{...person('synthetic-late-reserve','Synthetic Late Reserve',false,false),parityReserve:true,studentOnlyPartners:true}]);
let state=await ok(admin,'initialize',{roster,schedule:generateFast(roster,19,{baselineOnly:true})});
async function control(action){state=await ok(admin,'control',{expectedVersion:state.version,action});return state;}
async function startTimer(){const live=await ok(results,'state');await ok(admin,'timer/start',{expectedVersion:state.version,expectedPublicVersion:live.version,runId:live.runId,round:live.currentRound,timerVersion:live.timer.version});}
await control('start');assert.equal(state.live.currentRound,1);assert.equal(state.live.rounds[0].matches.length,13);
let pages=await ok(admin,'participant-admin');const existingToken=token(pages.participants[0]);
await ok(results,'participant/contact',{expectedVersion:0,contacts:{email:'synthetic-existing@example.test'}},existingToken);
await startTimer();assert.equal((await request(admin,'control',{expectedVersion:state.version,action:'next'})).status,409);
const beforeQueue=await ok(admin,'event-backup'),firstRound=structuredClone(state.live.rounds[0]),attempt=state.live.attemptId,oldSchedule=structuredClone(state.schedule);
const lateIds=['synthetic-late-student','synthetic-late-reserve'];
for(const ids of [[lateIds[0],lateIds[0]],[lateIds[0],'synthetic-0']])assert.notEqual((await request(admin,'late-join',{expectedVersion:state.version,expectedPublicVersion:state.live.version,ids})).status,200);
assert.equal((await request(admin,'late-join',{expectedVersion:state.version-1,expectedPublicVersion:state.live.version,ids:lateIds})).status,409);
assert.equal((await request(admin,'late-join',{expectedVersion:state.version,expectedPublicVersion:state.live.version-1,ids:lateIds})).status,409);
state=await ok(admin,'late-join',{expectedVersion:state.version,expectedPublicVersion:state.live.version,ids:lateIds});
assert.deepEqual(state.live.rounds,[firstRound]);assert.equal(state.live.currentRound,1);assert.deepEqual(state.schedule.rounds[0],oldSchedule.rounds[0]);assert.equal(state.lateJoin.fromRound,2);
const afterQueue=await ok(admin,'event-backup');assert.deepEqual(afterQueue.results.tables,beforeQueue.results.tables);assert.deepEqual(afterQueue.results.participantUrls,beforeQueue.results.participantUrls);
assert.equal((await request(admin,'late-join',{expectedVersion:state.version,expectedPublicVersion:state.live.version,ids:lateIds})).status,409);
const rewrite=structuredClone(state.schedule);rewrite.rounds[0].pairs[0].reverse();
assert.equal((await request(admin,'save',{expectedVersion:state.version,roster:state.roster,schedule:rewrite})).status,409);
expireLocalTimer();await ok(results,'participant/rounds/1',{rating:'smile',stayInTouch:false,attemptId:attempt},existingToken);
const beforeRelease=await ok(admin,'event-backup');await control('next');
assert.equal(state.live.currentRound,2);assert.equal(state.live.attemptId,attempt);assert.deepEqual(state.live.rounds[0],firstRound);assert.equal(state.live.rounds[1].matches.length,14);
const afterRelease=await ok(admin,'event-backup');
for(const table of ['participant_contacts','conversation_responses','round_timers','qr_reservations'])assert.deepEqual(afterRelease.results.tables[table],beforeRelease.results.tables[table]);
for(const old of beforeRelease.results.tables.participant_links)assert.deepEqual(afterRelease.results.tables.participant_links.find(p=>p.id===old.id),old);
pages=await ok(admin,'participant-admin');assert.equal(pages.participants.length,28);assert.equal(pages.responses.length,1);
const lateTokens=lateIds.map(id=>token(pages.participants.find(p=>p.id===id)));
for(const t of lateTokens){assert.deepEqual((await ok(results,'participant',null,t)).rounds,[]);assert.equal((await request(results,'participant/rounds/1',{rating:'neutral',stayInTouch:false,attemptId:attempt},t)).status,403);}
assert.equal((await ok(results,'participant',null,existingToken)).profile.contacts.email,'synthetic-existing@example.test');
assert.equal((await ok(results,'participant',null,existingToken)).rounds[0].response.rating,'smile');
await startTimer();expireLocalTimer();
for(const t of lateTokens){const own=await ok(results,'participant',null,t);assert.deepEqual(own.rounds.map(r=>r.number),[2]);await ok(results,'participant/rounds/2',{rating:'neutral',stayInTouch:false,attemptId:attempt},t);}

// Restore the original valid 26-person suffix after the two late arrivals leave.
for(const [i,t] of lateTokens.entries())await ok(results,'participant/contact',{expectedVersion:0,contacts:{email:`synthetic-departing-${i}@example.test`}},t);
const releasedPrefix=structuredClone(state.live.rounds),schedulePrefix=structuredClone(state.schedule.rounds.slice(0,2));
const remainingRounds=[...schedulePrefix,...structuredClone(oldSchedule.rounds.slice(2))];
const departureBody=()=>({expectedVersion:state.version,expectedPublicVersion:state.live.version,ids:lateIds,rounds:remainingRounds});
assert.equal((await request(admin,'withdrawals',{...departureBody(),expectedVersion:state.version-1})).status,409);
assert.equal((await request(admin,'withdrawals',{...departureBody(),expectedPublicVersion:state.live.version-1})).status,409);
assert.notEqual((await request(admin,'withdrawals',{...departureBody(),ids:[lateIds[0],lateIds[0]]})).status,200);
assert.notEqual((await request(admin,'withdrawals',{...departureBody(),rounds:remainingRounds.slice(0,11)})).status,200);
const changedPast=structuredClone(remainingRounds);changedPast[0].pairs[0].reverse();
assert.equal((await request(admin,'withdrawals',{...departureBody(),rounds:changedPast})).status,409);
const repeatedFuture=structuredClone(remainingRounds);repeatedFuture[3].pairs=structuredClone(repeatedFuture[2].pairs);
assert.notEqual((await request(admin,'withdrawals',{...departureBody(),rounds:repeatedFuture})).status,200);
assert.equal((await request(admin,'save',{expectedVersion:state.version,roster:state.roster,schedule:state.schedule})).status,409);
const beforeWithdrawals=await ok(admin,'event-backup'),beforeWithdrawalLive=structuredClone(state.live),beforeWithdrawalPages=await ok(admin,'participant-admin');
state=await ok(admin,'withdrawals',departureBody());
assert.equal(state.withdrawals.fromRound,3);assert.deepEqual(state.live,beforeWithdrawalLive);assert.deepEqual(state.schedule.rounds.slice(0,2),schedulePrefix);
for(const id of lateIds)assert.equal(state.roster.find(p=>p.id===id).included,false);
const queuedWithdrawals=await ok(admin,'event-backup');assert.deepEqual(queuedWithdrawals.results.tables,beforeWithdrawals.results.tables);assert.deepEqual(queuedWithdrawals.results.participantUrls,beforeWithdrawals.results.participantUrls);
assert.equal((await request(admin,'withdrawals',departureBody())).status,409);
await control('next');assert.equal(state.live.currentRound,3);assert.equal(state.live.attemptId,attempt);assert.deepEqual(state.live.rounds.slice(0,2),releasedPrefix);assert.equal(state.live.rounds[2].matches.length,13);
const afterWithdrawalRelease=await ok(admin,'event-backup');
for(const table of ['participant_links','participant_contacts','conversation_responses','round_timers','qr_reservations'])assert.deepEqual(afterWithdrawalRelease.results.tables[table],beforeWithdrawals.results.tables[table]);
const historicalPages=await ok(admin,'participant-admin');assert.equal(historicalPages.participants.length,28);assert.deepEqual(historicalPages.participants,beforeWithdrawalPages.participants);assert.equal(historicalPages.responses.length,3);
const sync=await ok(admin,'participant-admin',{expectedVersion:state.version,action:'sync',mode:'real'});assert.equal(sync.participants.length,28);
await startTimer();expireLocalTimer();
for(const [i,t] of lateTokens.entries()){
 const own=await ok(results,'participant',null,t);assert.deepEqual(own.rounds.map(r=>r.number),[2]);assert.equal(own.profile.contacts.email,`synthetic-departing-${i}@example.test`);assert.equal(own.rounds[0].response.rating,'neutral');
 assert.equal((await request(results,'participant/rounds/3',{rating:'neutral',stayInTouch:false,attemptId:attempt},t)).status,403);
}
assert.equal((await ok(results,'participant',null,existingToken)).profile.contacts.email,'synthetic-existing@example.test');
assert.equal((await ok(results,'participant',null,existingToken)).rounds[0].response.rating,'smile');
console.log('Passed local late-arrival and departure integration: 26 to 28 to 26 participants; queued changes preserved current rounds, timers, contacts, feedback and QR identities; historical participant pages stayed accessible; stale, invalid, repeated-pair and past-rewrite requests failed.');
