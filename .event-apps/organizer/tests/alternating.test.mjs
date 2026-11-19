import test from 'node:test';import assert from 'node:assert/strict';import loadHighs from 'highs';
import {normalizeRoster,generateFast,validateSchedule} from '../lib/matching.mjs';
import {generateAlternating} from '../lib/alternating-solver.mjs';import {generateGeneral} from '../lib/general-solver.mjs';import {assignStations} from '../lib/stations.mjs';
function fixture(){
 const rows=[];
 for(let i=0;i<20;i++)rows.push({id:`s${i}`,name:`Student ${i}`,isMpdStudent:true,isStudent:true,level:i<7?'People leader':i===7?'Principal':'Senior',jobs:['Student'],employmentStatus:[6,8,9,10,11,12,19].includes(i)?'Unemployed':'Employed',currentPeopleLeader:i<4,included:true,studentPairAnchor:i===19,alternateStudentPartners:i===19});
 for(let i=0;i<20;i++)rows.push({id:`n${i}`,name:`Professional ${i}`,isMpdStudent:false,isStudent:false,level:i<8?'People leader':[12,14,15].includes(i)?'Principal':'Senior',jobs:i>=8&&i<=14?['Product Management']:['Other'],employmentStatus:[6,7,8].includes(i)?'Unemployed':'Employed',currentPeopleLeader:i<6,included:true,unemployedMatchingPriority:i===15});
 return normalizeRoster(rows);
}
test('alternating exception creates six distinct student pairs and six leader pairs while preserving all priorities',()=>{
 for(const seed of [1,42,9887,20261119,4294967295]){
  const r=fixture(),s=generateAlternating(r,seed),m=validateSchedule(r,s),byId=new Map(r.map(a=>[a.id,a]));
  assert.equal(s.optimizationStatus,'optimal');assert.equal(m.studentPairs,6);assert.equal(m.anchorPairs,6);assert.equal(m.nonStudentPairs,6);assert.equal(m.currentLeaderPairs,30);assert.equal(m.leadersCovered,15);assert.equal(m.priorityUnemployedPairs,7);assert.equal(m.careerPairs,50);
  for(const rd of s.rounds){const ss=rd.pairs.filter(p=>p.every(id=>byId.get(id).isMpdStudent)),nn=rd.pairs.filter(p=>p.every(id=>!byId.get(id).isMpdStudent));assert.equal(ss.length,rd.number%2);assert.equal(nn.length,rd.number%2);assert(ss.every(p=>p.includes('s19')));}
  const stationed=assignStations(s,r);assert.equal(validateSchedule(r,stationed).stationStays,220);
 }
});
test('validator rejects an all-cross-cohort schedule and student pairs outside the configured exception',()=>{
 const r=fixture(),old=generateFast(r.map(a=>({...a,alternateStudentPartners:false})),4);assert.throws(()=>validateSchedule(r,old),/must meet MPD²|must meet/);
 const s=generateAlternating(r,4),bad=structuredClone(s),byId=new Map(r.map(a=>[a.id,a]));
 const positions=bad.rounds[0].pairs.map((p,i)=>({p,i})).filter(({p})=>p.some(id=>byId.get(id).isMpdStudent)&&p.some(id=>!byId.get(id).isMpdStudent&&!byId.get(id).currentPeopleLeader));
 const [a,b]=positions;const student=p=>p.find(id=>byId.get(id).isMpdStudent),other=p=>p.find(id=>!byId.get(id).isMpdStudent);
 bad.rounds[0].pairs[a.i]=[student(a.p),student(b.p)];bad.rounds[0].pairs[b.i]=[other(a.p),other(b.p)];assert.throws(()=>validateSchedule(r,bad),/Only the alternating anchor/);
 const swapped=structuredClone(s);[swapped.rounds[0],swapped.rounds[1]]=[swapped.rounds[1],swapped.rounds[0]];swapped.rounds.forEach((x,i)=>x.number=i+1);assert.throws(()=>validateSchedule(r,swapped),/must meet/);
});
test('full optimizer supports the alternating rule when leader-exchange construction does not apply',async()=>{
 const roster=normalizeRoster(Array.from({length:24},(_,i)=>({id:`person${i}`,name:`Person ${i}`,isMpdStudent:i<12,isStudent:i<12,level:null,jobs:[],employmentStatus:null,included:true,studentPairAnchor:i===0,alternateStudentPartners:i===0})));
 const highs=await loadHighs(),s=generateGeneral(roster,6,highs,()=>{},15),m=validateSchedule(roster,s);assert.equal(m.studentPairs,6);assert.equal(m.nonStudentPairs,6);assert.equal(m.anchorPairs,6);assert.equal(s.optimizationStatus,'optimal');
});
test('incompatible cohort counts produce a clear error instead of violating the exception',async()=>{
 const roster=normalizeRoster(Array.from({length:38},(_,i)=>({id:`p${i}`,name:`Person ${i}`,isMpdStudent:i<20,isStudent:i<20,level:null,jobs:[],employmentStatus:null,included:true,studentPairAnchor:i===0,alternateStudentPartners:i===0})));
 const highs=await loadHighs();assert.throws(()=>generateGeneral(roster,6,highs),/at least as many non-students/);
});
test('approved extra exception pairs a 20/18 roster without repeats and rejects a missing extra pair',()=>{
 const r=fixture().filter(a=>!['n5','n19'].includes(a.id));r.find(a=>a.studentPairAnchor).allowAdditionalStudentPair=true;
 for(const seed of [1,42]){
  const s=generateAlternating(r,seed),m=validateSchedule(r,s),byId=new Map(r.map(a=>[a.id,a]));
  assert.equal(m.participants,38);assert.equal(m.studentPairs,18);assert.equal(m.anchorPairs,6);assert.equal(m.nonStudentPairs,6);
  for(const rd of s.rounds){const ss=rd.pairs.filter(p=>p.every(id=>byId.get(id).isMpdStudent));assert.equal(ss.filter(p=>!p.includes('s19')).length,1);assert.equal(ss.length,1+rd.number%2);}
  assert.equal(validateSchedule(r,assignStations(s,r)).stationStays,209);
  const strict=r.map(a=>({...a,allowAdditionalStudentPair:false}));assert.throws(()=>validateSchedule(strict,s),/Only the alternating anchor/);
 }
});
test('full optimizer maximizes current leader meetings under the approved extra exception',async()=>{
 const r=fixture().filter(a=>!['n5','n19'].includes(a.id));r.find(a=>a.studentPairAnchor).allowAdditionalStudentPair=true;
 const highs=await loadHighs(),baseline=generateAlternating(r,2026111901),s=generateGeneral(r,2026111901,highs,()=>{},60,baseline),m=validateSchedule(r,s);
 assert.equal(m.currentLeaderPairs,32);assert.equal(m.currentLeaderPairs,m.currentLeaderUpperBound);assert.equal(m.leadersCovered,m.totalLeaders);assert.equal(m.studentPairs,18);assert.equal(m.nonStudentPairs,6);
});
test('extra exception resets to zero for balanced cohorts and cannot expand beyond one per round',()=>{
 const r=fixture();r.find(a=>a.studentPairAnchor).allowAdditionalStudentPair=true;assert.equal(generateAlternating(r,42).metrics.additionalStudentPairsPerRound,0);
 const unbalanced=r.filter(a=>!['n16','n17','n18','n19'].includes(a.id));assert.throws(()=>generateAlternating(unbalanced,1),/At most one additional/);
});
