import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRoster,circleSchedule,validateSchedule,scheduledParticipants,roundParticipants} from '../lib/matching.mjs';
import {assignStations} from '../lib/stations.mjs';
import {publicSnapshot} from '../lib/event-snapshot.mjs';
import {queueLateJoin} from '../lib/late-join.mjs';
import {queueWithdrawals} from '../lib/withdrawals.mjs';
import {generate} from '../scripts/generate-future-rounds.mjs';

const arrivalIds=['synthetic-new-student','synthetic-new-reserve'],departingIds=['synthetic-0','synthetic-13'];
function fixture(){
 const roster=normalizeRoster([...Array.from({length:26},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Attendee ${i}`,isMpdStudent:i<13,isStudent:i<13,level:'Senior',jobs:[],employmentStatus:'Employed',included:true})),{id:arrivalIds[0],name:'Synthetic New Student',isMpdStudent:true,isStudent:true,level:'Senior',jobs:['Student'],employmentStatus:'Employed',included:false},{id:arrivalIds[1],name:'Synthetic New Reserve',isMpdStudent:false,isStudent:false,level:'Senior',jobs:[],employmentStatus:'Employed',included:false,parityReserve:true,studentOnlyPartners:true}]);
 const schedule=assignStations(circleSchedule(roster,23),roster);schedule.metrics=validateSchedule(roster,schedule);
 const state={version:12,locked:true,pending:null,roster,schedule};
 state.live={...publicSnapshot(state,'live',3,false),version:9,runId:'synthetic-run',attemptId:'synthetic-attempt',timer:{version:2,status:'running',deadlineAt:9999999999999,remainingMs:123456,complete:false}};
 const joined=queueLateJoin(state,state.live,arrivalIds);joined.version=13;
 joined.live={...joined.live,...publicSnapshot(joined,'live',6,false),version:12};
 return joined;
}
const state=fixture(),proposal=await generate(state,departingIds,{seconds:10,optimize:false});

test('departures replace all future rounds while preserving the released prefix, live timer, and historical participants',()=>{
 const before=structuredClone(state),next=queueWithdrawals(state,state.live,departingIds,proposal.rounds);
 assert.deepEqual(state,before);assert.equal(next.live,state.live);assert.equal(next.live.timer,state.live.timer);
 assert.deepEqual(next.schedule.rounds.slice(0,6),state.schedule.rounds.slice(0,6));
 assert.deepEqual(next.schedule.participationStarts,state.schedule.participationStarts);
 assert.deepEqual(next.schedule.participationEnds,Object.fromEntries(departingIds.map(id=>[id,7])));
 assert.deepEqual(next.roster.filter(a=>!departingIds.includes(a.id)),state.roster.filter(a=>!departingIds.includes(a.id)));
 assert(next.roster.filter(a=>departingIds.includes(a.id)).every(a=>!a.included));
 assert.equal(scheduledParticipants(next.roster,next.schedule).length,28);
 assert.equal(roundParticipants(next.roster,next.schedule,3).length,26);
 assert.equal(roundParticipants(next.roster,next.schedule,6).length,28);
 assert.equal(roundParticipants(next.roster,next.schedule,7).length,26);
 for(const r of next.schedule.rounds.slice(6)){assert.equal(r.pairs.length,13);assert(r.pairs.flat().every(id=>!departingIds.includes(id)));}
 assert.equal(next.schedule.metrics.participants,26);assert.equal(next.schedule.metrics.pairsPerRound,13);assert.equal(next.schedule.metrics.activeStations,13);
 assert.equal(validateSchedule(next.roster,next.schedule).participants,26);
});

test('withdrawal transaction rejects stale, unsafe, repeated, and inactive-attendee requests',()=>{
 for(const change of [s=>s.locked=false,s=>s.pending={operationId:'synthetic-pending'},s=>s.live.isTest=true,s=>s.live.status='waiting',s=>s.live.currentRound=0,s=>s.live.currentRound=12]){
  const s=structuredClone(state);change(s);const before=structuredClone(s);assert.throws(()=>queueWithdrawals(s,s.live,departingIds,proposal.rounds));assert.deepEqual(s,before);
 }
 for(const ids of [[],[departingIds[0]],[departingIds[0],departingIds[0]],['missing',departingIds[1]]])assert.throws(()=>queueWithdrawals(state,state.live,ids,proposal.rounds));
 const live=structuredClone(state.live);live.version++;assert.throws(()=>queueWithdrawals(state,live,departingIds,proposal.rounds),/changed/);
 const next=queueWithdrawals(state,state.live,departingIds,proposal.rounds);assert.throws(()=>queueWithdrawals(next,next.live,departingIds,proposal.rounds),/already been queued/);
 assert.throws(()=>queueWithdrawals(state,state.live,departingIds,proposal.rounds.slice(1)),/all twelve/);
});

test('released schedule content and station assignments cannot be changed by a proposal',()=>{
 const rounds=structuredClone(proposal.rounds);rounds[0].stations[0]=21;
 assert.throws(()=>queueWithdrawals(state,state.live,departingIds,rounds),/Released schedule rounds/);
 const s=structuredClone(state);[s.schedule.rounds[0].pairs[0],s.schedule.rounds[0].pairs[1]]=[s.schedule.rounds[0].pairs[1],s.schedule.rounds[0].pairs[0]];
 const altered=structuredClone(proposal.rounds);altered[0]=structuredClone(s.schedule.rounds[0]);
 assert.throws(()=>queueWithdrawals(s,s.live,departingIds,altered),/no longer matches/);
});

test('a paused event can queue departures without resuming its timer',()=>{
 const s=structuredClone(state);s.live.status='break';s.live.timer.status='paused';
 const next=queueWithdrawals(s,s.live,departingIds,proposal.rounds);assert.equal(next.live,s.live);assert.equal(next.live.status,'break');assert.equal(next.live.timer.status,'paused');
});

test('departures reject invalid metadata, future attendance, repeated pairs, partner rules, and stations',()=>{
 const next=queueWithdrawals(state,state.live,departingIds,proposal.rounds);
 for(const ends of [null,[],{}, {[departingIds[0]]:7},{missing:7,[departingIds[1]]:7},{[departingIds[0]]:1,[departingIds[1]]:1},{[departingIds[0]]:13,[departingIds[1]]:13},{[departingIds[0]]:7,[departingIds[1]]:8}])assert.throws(()=>validateSchedule(next.roster,{...next.schedule,participationEnds:ends}));
 const selected=structuredClone(next.roster);selected.find(a=>a.id===departingIds[0]).included=true;assert.throws(()=>validateSchedule(selected,next.schedule),/even roster|departure/);
 const bad=structuredClone(proposal.rounds);bad[6].pairs[0][0]=departingIds[0];assert.throws(()=>queueWithdrawals(state,state.live,departingIds,bad),/unknown or repeated/);
 const repeated=structuredClone(proposal.rounds);repeated[7]=structuredClone(repeated[6]);repeated[7].number=8;assert.throws(()=>queueWithdrawals(state,state.live,departingIds,repeated),/repeated across/);
 const missing=structuredClone(proposal.rounds);missing[6].pairs.pop();assert.throws(()=>queueWithdrawals(state,state.live,departingIds,missing),/incomplete/);
 const stations=structuredClone(proposal.rounds);stations[6].stations[1]=stations[6].stations[0];assert.throws(()=>queueWithdrawals(state,state.live,departingIds,stations),/Stations must/);
 const badRoster=structuredClone(next.roster),pair=next.schedule.rounds[6].pairs.find(p=>p.includes(arrivalIds[1])),partner=pair.find(id=>id!==arrivalIds[1]);badRoster.find(a=>a.id===partner).isMpdStudent=false;assert.throws(()=>validateSchedule(badRoster,next.schedule),/MPD²-only/);
 assert.throws(()=>roundParticipants(next.roster,next.schedule,0),/1 through 12/);
});
