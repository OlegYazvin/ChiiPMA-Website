import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeRoster,participants,generateFast,validateSchedule,careerPair} from '../lib/matching.mjs';
import {waitingState,sanitizePublicState,validateTransition} from '../lib/public-state.mjs';
function fixture(){
 const people=[];
 for(let i=0;i<20;i++)people.push({id:`s${i}`,name:`Student ${i}`,isMpdStudent:true,isStudent:true,level:i<7?'People leader':i===7?'Principal':'Senior',jobs:['Student'],employmentStatus:[6,8,9,10,11,12,19].includes(i)?'Unemployed':'Employed',currentPeopleLeader:i<4,included:true,studentPairAnchor:i===19});
 for(let i=0;i<19;i++)people.push({id:`p${i}`,name:`Professional ${i}`,isMpdStudent:false,isStudent:false,level:i<8?'People leader':i===12||i===13?'Principal':'Senior',jobs:i>=8&&i<=12||i===18?['Product Management']:['Other'],employmentStatus:[6,7,8].includes(i)?'Unemployed':'Employed',currentPeopleLeader:i<6,included:true,parityReserve:i===18,unemployedMatchingPriority:i===13});
 return normalizeRoster(people);
}
test('all attendees appear once per round, every pair is unique, and all priority optima coexist',()=>{
 const r=fixture(),s=generateFast(r,44),m=validateSchedule(r,s);assert.equal(m.participants,38);assert.equal(m.studentPairs,12);assert.equal(m.anchorPairs,12);assert.equal(m.currentLeaderPairs,24);assert.equal(m.leadersCovered,15);assert.equal(m.priorityUnemployedPairs,6);assert.equal(m.careerPairs,39);
 const keys=s.rounds.flatMap(r=>r.pairs.map(p=>[...p].sort().join(':')));assert.equal(new Set(keys).size,228);
});
test('parity reserve is excluded for even counts and included for odd counts',()=>{
 const r=fixture();assert(!participants(r).some(a=>a.parityReserve));r.find(a=>a.id==='p17').included=false;assert.equal(participants(r).length,38);assert(participants(r).some(a=>a.parityReserve));assert.doesNotThrow(()=>validateSchedule(r,generateFast(r,33)));
});
test('anchor absent uses a balanced cross-cohort schedule with no student pairs',()=>{const r=fixture();r.find(a=>a.studentPairAnchor).included=false;const s=generateFast(r,12);assert.equal(s.metrics.studentPairs,0);});
test('missing classifications do not exclude attendees or invent career advantages',()=>{const r=fixture();r.find(a=>a.id==='p17').level=null;r.find(a=>a.id==='p17').employmentStatus=null;assert.equal(validateSchedule(r,generateFast(r,1)).participants,38);assert.equal(careerPair(r[19],r.find(a=>a.id==='p17')),false);});
test('validator rejects omissions, self matches and repeated pairs including reversed order',()=>{
 const r=fixture(),s=generateFast(r,22);const broken=structuredClone(s);broken.rounds[1].pairs=structuredClone(broken.rounds[0].pairs).map(p=>p.reverse());assert.throws(()=>validateSchedule(r,broken),/repeated/);
 const omitted=structuredClone(s);omitted.rounds[0].pairs.pop();assert.throws(()=>validateSchedule(r,omitted),/incomplete/);
 const self=structuredClone(s);self.rounds[0].pairs[0][1]=self.rounds[0].pairs[0][0];assert.throws(()=>validateSchedule(r,self),/repeated attendee/);
});
test('historical-only leaders do not count toward the current leader objective',()=>{const r=fixture(),a=r.find(a=>a.id==='s4');assert.equal(a.level,'People leader');assert.equal(a.currentPeopleLeader,false);const s=generateFast(r,19);assert.equal(s.metrics.currentLeaderPairs,24);});
test('invalid IDs and contradictory current-leader flags fail early',()=>{const r=fixture();r[1].id=r[0].id;assert.throws(()=>normalizeRoster(r),/unique/);const q=fixture();q[0].employmentStatus='Unemployed';assert.throws(()=>normalizeRoster(q),/active employed/);});
test('public whitelist strips classifications and all extra supplied fields',()=>{
 const publicState=sanitizePublicState({eventId:'chipma-2026-11-19',status:'live',currentRound:1,secret:'never',rounds:[{number:1,hidden:'never',matches:[{names:['Person A','Person B'],employmentStatus:'never'}]}]});
 assert(!JSON.stringify(publicState).includes('never'));assert.deepEqual(publicState.rounds[0].matches[0],{pairNumber:1,station:1,names:['Person A','Person B']});
});
test('public feed enforces sequential release, immutable history, and valid breaks',()=>{
 const first=sanitizePublicState({eventId:'chipma-2026-11-19',status:'live',currentRound:1,rounds:[{number:1,matches:[{names:['A','B']},{names:['C','D']}]}]});
 assert.doesNotThrow(()=>validateTransition(waitingState(),first));assert.doesNotThrow(()=>validateTransition(first,{...first,status:'break'}));assert.doesNotThrow(()=>validateTransition({...first,status:'break'},first));
 assert.throws(()=>validateTransition(first,{...first,currentRound:3}),/one round/);assert.throws(()=>validateTransition(first,{...first,rounds:[]}),/immutable/);
 const finished=sanitizePublicState({...first,status:'finished'});assert.deepEqual(finished.rounds,first.rounds);
 assert.doesNotThrow(()=>validateTransition(first,finished));assert.doesNotThrow(()=>validateTransition({...first,status:'break'},finished));
 assert.throws(()=>sanitizePublicState({...waitingState(),status:'finished'}),/status/);
 assert.throws(()=>validateTransition(finished,first),/finished/);
});
test('test runs reset to an empty waiting display; real events cannot reset',()=>{
 const live=sanitizePublicState({eventId:'chipma-2026-11-19',status:'live',isTest:true,currentRound:1,rounds:[{number:1,matches:[{names:['A','B']}]}]});
 assert.doesNotThrow(()=>validateTransition(live,waitingState(),{resetTest:true}));
 assert.throws(()=>validateTransition({...live,isTest:false},waitingState(),{resetTest:true}),/Only a test/);
 assert.throws(()=>validateTransition(live,waitingState()),/test mode|one round/);
 assert.throws(()=>validateTransition(live,{...live,isTest:false,status:'break'}),/cannot change test mode/);
 assert.throws(()=>sanitizePublicState({...live,isTest:'true'}),/test mode/);
});
test('a completed test can reset, and legacy saved states default to real mode',()=>{
 const finished={...waitingState(),status:'finished',isTest:true,currentRound:12};
 assert.doesNotThrow(()=>validateTransition(finished,waitingState(),{resetTest:true}));
 assert.equal(sanitizePublicState({eventId:'chipma-2026-11-19',status:'waiting',currentRound:0,rounds:[]}).isTest,false);
});
