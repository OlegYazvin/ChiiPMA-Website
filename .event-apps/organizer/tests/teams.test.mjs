import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {normalizeRoster,participants,pairAllowed,generateFast,validateSchedule} from '../lib/matching.mjs';
import {alternatingBaseline} from '../lib/alternating-solver.mjs';
import {generateGeneral} from '../lib/general-solver.mjs';
const fixture=(s=20,n=20)=>normalizeRoster(Array.from({length:s+n},(_,i)=>({id:`p${i}`,name:`Person ${i}`,isMpdStudent:i<s,isStudent:i<s,level:i<s?'Principal':'Senior',jobs:i<s?['Student']:['Product Management'],employmentStatus:'Employed',included:true,studentPairAnchor:i===0,alternateStudentPartners:i===0})));
function noTeammates(roster,schedule){const byid=new Map(roster.map(a=>[a.id,a]));validateSchedule(roster,schedule);for(const rd of schedule.rounds)for(const pair of rd.pairs)assert(pairAllowed(...pair.map(id=>byid.get(id))));}
test('team labels normalize and survive import/export without grouping unassigned attendees',()=>{
 const r=fixture();r[0].teamId=' Team Alpha ';r[1].teamId='TEAM ALPHA';const saved=normalizeRoster(JSON.parse(JSON.stringify(r)));assert.equal(saved[0].teamId,'team alpha');assert(!pairAllowed(saved[0],saved[1]));assert(pairAllowed(saved[2],saved[3]));
 for(const invalid of [42,{},'x'.repeat(81)]){r[0].teamId=invalid;assert.throws(()=>normalizeRoster(r),/Team must/);}
});
test('all three edges of a three-person team are excluded, in either pair orientation',()=>{
 const r=fixture();for(const i of [1,2,3])r[i].teamId='trio';for(const i of [1,2,3])for(const j of [1,2,3])if(i!==j)assert(!pairAllowed(r[i],r[j]));assert(pairAllowed(r[1],r[4]));
});
test('validator rejects a previously valid conversation after both partners receive the same team',()=>{
 const r=fixture().map(a=>({...a,alternateStudentPartners:false})),s=generateFast(r,3),pair=s.rounds[0].pairs[0];for(const a of r)if(pair.includes(a.id))a.teamId='new-team';assert.throws(()=>validateSchedule(r,s),/same team/);
});
test('fast and alternating generators exclude teammates, including the alternating anchor and extra student pairs',()=>{
 for(const seed of [1,42,1337]){
  const balanced=fixture();balanced[0].teamId=balanced[1].teamId='anchor-team';for(const i of [2,3,4])balanced[i].teamId='student-trio';balanced[20].studentOnlyPartners=true;
  noTeammates(balanced,alternatingBaseline(balanced,seed));
  const fast=balanced.map(a=>({...a,alternateStudentPartners:false}));fast[5].teamId=fast[25].teamId=fast[26].teamId='mixed-trio';noTeammates(fast,generateFast(fast,seed));
  const extra=fixture(20,18);extra[0].allowAdditionalStudentPair=true;extra[0].teamId=extra[1].teamId='anchor-team';for(const i of [2,3,4])extra[i].teamId='student-trio';noTeammates(extra,alternatingBaseline(extra,seed));
 }
});
test('full optimizer removes blocked edges and replaces a conflicting initial schedule',async()=>{
 const r=fixture(12,12),old=alternatingBaseline(r,6),pair=old.rounds[0].pairs.find(p=>p.includes('p0'));for(const a of r)if(pair.includes(a.id))a.teamId='anchor-team';r[12].studentOnlyPartners=true;
 assert.throws(()=>validateSchedule(r,old),/same team|MPD²-only/);
 const highs=await loadHighs(),s=generateGeneral(r,6,highs,()=>{},15,old);noTeammates(r,s);assert.equal(s.metrics.nonStudentPairs,6);assert.equal(s.metrics.careerPairs,132);assert.equal(s.optimizationStatus,'optimal');
});
test('too few eligible partners fails before optimization instead of relaxing team exclusions',()=>{
 const r=fixture(7,7);for(const i of [0,1,2])r[i].teamId='team';assert.throws(()=>participants(r),/twelve eligible partners outside their team/);
});
