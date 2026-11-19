import test from 'node:test';
import assert from 'node:assert/strict';
import loadHighs from 'highs';
import {normalizeRoster,participants,pairAllowed,validateSchedule,generateFast,circleSchedule} from '../lib/matching.mjs';
import {alternatingBaseline} from '../lib/alternating-solver.mjs';
import {generateGeneral} from '../lib/general-solver.mjs';
const fixture=(s=20,n=20)=>normalizeRoster(Array.from({length:s+n},(_,i)=>({id:`person${i}`,name:`Person ${i}`,isMpdStudent:i<s,isStudent:i<s,level:i<s?'Principal':'Senior',jobs:i<s?['Student']:['Product Management'],employmentStatus:'Employed',included:true,studentPairAnchor:i===0,alternateStudentPartners:i===0})));
function checkPartners(roster,schedule,id){const byId=new Map(roster.map(a=>[a.id,a]));const partners=schedule.rounds.map(r=>r.pairs.find(p=>p.includes(id)).find(x=>x!==id));assert.equal(new Set(partners).size,12);assert(partners.every(id=>byId.get(id).isMpdStudent));validateSchedule(roster,schedule);}
test('student-only restriction survives roster export/import and requires MPD² membership in either pair position',()=>{
 const r=fixture(),a=r[20];a.studentOnlyPartners=true;const imported=normalizeRoster(JSON.parse(JSON.stringify(r)));assert.equal(imported[20].studentOnlyPartners,true);assert.equal(imported[21].studentOnlyPartners,false);
 assert(pairAllowed(a,r[0]));assert(pairAllowed(r[0],a));assert(!pairAllowed(a,r[21]));assert(!pairAllowed(r[21],a));r[21].isStudent=true;assert(!pairAllowed(a,r[21]));
});
test('student-only parity reserve is checked only when attendance includes it',()=>{
 const r=fixture(8,15);r[22].parityReserve=true;r[22].studentOnlyPartners=true;assert.equal(participants(r).length,22);
 r[21].included=false;assert.throws(()=>participants(r),/at least twelve eligible MPD²/);
});
test('validator rejects a non-student pairing that was valid before adding the restriction',()=>{
 const r=fixture(),s=alternatingBaseline(r,17),byId=new Map(r.map(a=>[a.id,a]));
 const nn=s.rounds.flatMap(r=>r.pairs).find(p=>p.every(id=>!byId.get(id).isMpdStudent));assert(nn);byId.get(nn[0]).studentOnlyPartners=true;
 assert.throws(()=>validateSchedule(r,s),/MPD²-only partners/);
});
test('fast and alternating generators preserve the restriction over multiple random seeds',()=>{
 const r=fixture();r[20].studentOnlyPartners=true;r[20].parityReserve=true;
 for(const seed of [1,42,1337]){
  checkPartners(r,alternatingBaseline(r,seed),'person20');
  const clean=r.map(a=>({...a,alternateStudentPartners:false}));checkPartners(clean,generateFast(clean,seed),'person20');
 }
});
test('full optimizer enforces student-only partners and discards an invalid initial schedule',async()=>{
 const r=fixture(12,12);r[12].studentOnlyPartners=true;const invalid=circleSchedule(r,6);assert.throws(()=>validateSchedule(r,invalid));
 const highs=await loadHighs(),s=generateGeneral(r,6,highs,()=>{},15,invalid);checkPartners(r,s,'person12');assert.equal(s.metrics.nonStudentPairs,6);assert.equal(s.metrics.careerPairs,132);
});
