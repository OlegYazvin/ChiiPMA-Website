import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRoster,participants,scheduledParticipants,circleSchedule,validateSchedule,pairAllowed} from '../lib/matching.mjs';
import {assignStations} from '../lib/stations.mjs';
import {publicSnapshot} from '../lib/event-snapshot.mjs';
import {queueLateJoin} from '../lib/late-join.mjs';

const arrivalIds=['synthetic-arrival-student','synthetic-arrival-reserve'];
function fixture(currentRound=7){
 const roster=normalizeRoster([...Array.from({length:14},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Attendee ${i}`,isMpdStudent:i<7,isStudent:i<7,level:'Senior',jobs:[],employmentStatus:'Employed',included:true})),{id:arrivalIds[0],name:'Synthetic Late Student',isMpdStudent:true,isStudent:true,level:'Senior',jobs:['Student'],employmentStatus:'Employed',included:false},{id:arrivalIds[1],name:'Synthetic Late Reserve',isMpdStudent:false,isStudent:false,level:'Senior',jobs:[],employmentStatus:'Employed',included:false,parityReserve:true,studentOnlyPartners:true}]);
 const schedule=assignStations(circleSchedule(roster,43),roster);schedule.metrics=validateSchedule(roster,schedule);
 const state={version:12,locked:true,pending:null,roster,schedule,questionBank:{questions:[],round_assignments:[]}};
 state.live={...publicSnapshot(state,'live',currentRound,false),version:9,runId:'synthetic-real-run',attemptId:'synthetic-attempt',timer:{version:2,status:'running',deadlineAt:9999999999999,remainingMs:123456,complete:false}};
 return state;
}

test('late arrivals begin next round while past rounds, live timer, selections, and other future pairs remain intact',()=>{
 const state=fixture(),before=structuredClone(state),next=queueLateJoin(state,state.live,arrivalIds),fromRound=state.live.currentRound+1;
 assert.deepEqual(state,before);assert.equal(next.live,state.live);assert.equal(next.live.timer,state.live.timer);
 assert.deepEqual(next.schedule.rounds.slice(0,fromRound-1),state.schedule.rounds.slice(0,fromRound-1));
 assert.deepEqual(next.schedule.participationStarts,Object.fromEntries(arrivalIds.map(id=>[id,fromRound])));
 assert.equal(next.lateJoin.fromRound,fromRound);assert.equal(next.schedule.optimizationStatus,'feasible; late arrivals');
 assert.deepEqual(next.roster.filter(a=>!arrivalIds.includes(a.id)),state.roster.filter(a=>!arrivalIds.includes(a.id)));
 assert.throws(()=>participants(next.roster),/twelve eligible MPD²/);
 assert.equal(scheduledParticipants(next.roster,next.schedule).length,16);
 const byId=new Map(next.roster.map(a=>[a.id,a]));
 for(const r of next.schedule.rounds.slice(fromRound-1)){
  const original=state.schedule.rounds[r.number-1];assert.equal(r.pairs.length,original.pairs.length+1);
  const removed=original.pairs.filter((pair,i)=>JSON.stringify(pair)!==JSON.stringify(r.pairs[i]));assert.equal(removed.length,1);
  assert.deepEqual(r.stations.slice(0,-1),original.stations);
  for(const id of arrivalIds)assert.equal(r.pairs.flat().filter(person=>person===id).length,1);
  for(const pair of r.pairs)assert(pairAllowed(...pair.map(id=>byId.get(id))));
 }
 assert.equal(validateSchedule(next.roster,next.schedule).participants,16);
 assert.equal(next.schedule.metrics.activeStations,8);
 assert(next.schedule.metrics.stationStays<=next.schedule.metrics.maximumStationStays);
});

test('queue validates fresh real-event state and rejects repeat or unsafe requests without mutation',()=>{
 const cases=[s=>s.locked=false,s=>s.pending={operationId:'synthetic-pending'},s=>s.live.isTest=true,s=>s.live.status='waiting',s=>s.live.currentRound=0,s=>s.live.currentRound=12,s=>s.roster.find(a=>a.id===arrivalIds[0]).included=true,s=>s.roster.find(a=>a.id===arrivalIds[0]).qrPending=true];
 for(const change of cases){const state=fixture();change(state);const before=structuredClone(state);assert.throws(()=>queueLateJoin(state,state.live,arrivalIds));assert.deepEqual(state,before);}
 const state=fixture();
 for(const ids of [[],[arrivalIds[0]],[arrivalIds[0],arrivalIds[0]],['missing',arrivalIds[1]]])assert.throws(()=>queueLateJoin(state,state.live,ids));
 const live=structuredClone(state.live);live.version++;assert.throws(()=>queueLateJoin(state,live,arrivalIds),/changed/);
 const changed=structuredClone(state.live);changed.rounds[0].matches[0].station=21;assert.throws(()=>queueLateJoin(state,changed,arrivalIds),/changed/);
 const next=queueLateJoin(state,state.live,arrivalIds);assert.throws(()=>queueLateJoin(next,next.live,arrivalIds),/already been queued/);
});

test('a valid but different released schedule is rejected independently of the live prefix',()=>{
 const state=fixture();[state.schedule.rounds[0].pairs[0],state.schedule.rounds[0].pairs[1]]=[state.schedule.rounds[0].pairs[1],state.schedule.rounds[0].pairs[0]];
 assert.throws(()=>queueLateJoin(state,state.live,arrivalIds),/no longer matches/);
});

test('a break may queue arrivals without resuming or altering the paused timer',()=>{
 const state=fixture();state.live.status='break';state.live.timer.status='paused';
 const next=queueLateJoin(state,state.live,arrivalIds);assert.equal(next.live,state.live);assert.equal(next.live.status,'break');assert.equal(next.live.timer.status,'paused');
});

test('infeasible partner rules leave the event unchanged',()=>{
 const state=fixture();state.roster.filter(a=>a.included).forEach(a=>{a.isMpdStudent=false;a.isStudent=false;});
 const before=structuredClone(state);assert.throws(()=>queueLateJoin(state,state.live,arrivalIds));assert.deepEqual(state,before);
});

test('late schedule metadata and every round still enforce attendance, identities, pair uniqueness, partner rules, and stations',()=>{
 const next=queueLateJoin(fixture(),fixture().live,arrivalIds);
 for(const starts of [null,[],{}, {[arrivalIds[0]]:8},{unknown:8,[arrivalIds[1]]:8},{[arrivalIds[0]]:1,[arrivalIds[1]]:1},{[arrivalIds[0]]:13,[arrivalIds[1]]:13},{[arrivalIds[0]]:8.5,[arrivalIds[1]]:8.5},{[arrivalIds[0]]:8,[arrivalIds[1]]:9}]){
  assert.throws(()=>validateSchedule(next.roster,{...next.schedule,participationStarts:starts}));
 }
 const early=structuredClone(next.schedule);early.rounds[0].pairs[0][0]=arrivalIds[0];assert.throws(()=>validateSchedule(next.roster,early),/unknown or repeated/);
 const missing=structuredClone(next.schedule);missing.rounds[7].pairs.pop();assert.throws(()=>validateSchedule(next.roster,missing),/incomplete/);
 const repeated=structuredClone(next.schedule);repeated.rounds[8]=structuredClone(repeated.rounds[7]);repeated.rounds[8].number=9;assert.throws(()=>validateSchedule(next.roster,repeated),/repeated across/);
 const stations=structuredClone(next.schedule);stations.rounds[7].stations[1]=stations.rounds[7].stations[0];assert.throws(()=>validateSchedule(next.roster,stations),/Stations must/);
 const badPartner=structuredClone(next.roster),round=next.schedule.rounds[7],pair=round.pairs.find(p=>p.includes(arrivalIds[1])),partner=pair.find(id=>id!==arrivalIds[1]);badPartner.find(a=>a.id===partner).isMpdStudent=false;
 assert.throws(()=>validateSchedule(badPartner,next.schedule),/MPD²-only/);
});
