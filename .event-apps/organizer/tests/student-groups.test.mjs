import test from 'node:test';import assert from 'node:assert/strict';import loadHighs from 'highs';
import {normalizeRoster,participants,usesStudentGroups,pairAllowed,validateSchedule,generateFast} from '../lib/matching.mjs';
import {alternatingBaseline} from '../lib/alternating-solver.mjs';import {generateGeneral} from '../lib/general-solver.mjs';
function fixture(leaders=true){return normalizeRoster(Array.from({length:28},(_,i)=>({id:`p${i}`,name:`Person ${i}`,isMpdStudent:i<14,isStudent:i<14,studentPairGroup:i<3?'first_year':i<7?'second_year':i<14?'':null,level:leaders&&[3,4,14,15,16].includes(i)?'People leader':i<14?'Principal':'Senior',jobs:i<14?['Student']:[],employmentStatus:'Employed',currentPeopleLeader:leaders&&[3,4,14,15,16].includes(i),included:true,studentOnlyPartners:i===27})));}
test('only opposite eligible student groups can meet; unlisted and same-year students cannot',()=>{
 const r=fixture();assert(pairAllowed(r[0],r[3]));assert(pairAllowed(r[3],r[0]));assert(!pairAllowed(r[0],r[1]));assert(!pairAllowed(r[3],r[4]));assert(!pairAllowed(r[0],r[8]));assert(!pairAllowed(r[8],r[9]));assert(pairAllowed(r[8],r[14]));
 r[0].teamId=r[3].teamId='team';assert(!pairAllowed(r[0],r[3]));assert(!pairAllowed(r[27],r[14]));
});
test('group policy persists on import/export and replaces the alternating anchor exception',()=>{
 const r=fixture();r[0].studentPairAnchor=true;r[0].alternateStudentPartners=true;r[0].allowAdditionalStudentPair=true;delete r[8].studentPairGroup;
 const imported=normalizeRoster(JSON.parse(JSON.stringify(r)));assert(usesStudentGroups(imported));assert.equal(imported[8].studentPairGroup,'');assert.equal(imported[0].studentPairAnchor,false);assert.equal(imported[0].alternateStudentPartners,false);assert.equal(imported[0].allowAdditionalStudentPair,false);
 r[0].studentPairGroup='invalid';assert.throws(()=>normalizeRoster(r),/Invalid student conversation group/);assert.equal(generateFast(imported,4),null);
});
test('unattending group members remain outside every round and do not affect parity',()=>{
 const r=fixture();r.push(...Array.from({length:3},(_,i)=>({id:`extra${i}`,name:`Extra ${i}`,isMpdStudent:true,isStudent:true,studentPairGroup:'first_year',level:null,jobs:['Student'],employmentStatus:null,included:false})));
 const imported=normalizeRoster(r);assert.equal(imported.length,31);assert.equal(participants(imported).length,28);const base=generateFast(imported,4,{baselineOnly:true});assert(!base.rounds.some(rd=>rd.pairs.flat().some(id=>id.startsWith('extra'))));
});
test('validator rejects the previous alternating exception when its participants are ineligible',()=>{
 const legacy=fixture(false).map(a=>({...a,studentPairGroup:null,studentPairAnchor:a.id==='p0',alternateStudentPartners:a.id==='p0'})),old=alternatingBaseline(legacy,3);
 const strict=fixture(false);strict[0].studentPairGroup='';assert.throws(()=>validateSchedule(strict,old),/Student conversations must pair Group 1 with Group 2/);
});
test('eligible student pairs increase current-leader meetings, then are minimized at that maximum',async()=>{
 const r=fixture(),baseline=generateFast(r,31,{baselineOnly:true});assert.equal(baseline.metrics.currentLeaderPairs,6);assert.equal(baseline.metrics.studentPairs,0);
 const highs=await loadHighs(),s=generateGeneral(r,31,highs,()=>{},20,baseline),m=validateSchedule(r,s);assert.equal(s.optimizationStatus,'optimal');assert.equal(m.currentLeaderPairs,9);assert.equal(m.currentLeaderUpperBound,9);assert.equal(m.studentPairs,3);assert.equal(m.nonStudentPairs,3);assert.equal(m.leadersCovered,m.totalLeaders);
 for(const rd of s.rounds)for(const pair of rd.pairs){const [a,b]=pair.map(id=>r.find(a=>a.id===id));assert(pairAllowed(a,b));}
});
test('student pairs are avoided entirely when they cannot improve current-leader meetings',async()=>{
 const r=fixture(false),highs=await loadHighs(),s=generateGeneral(r,8,highs,()=>{},15);assert.equal(s.metrics.currentLeaderPairs,0);assert.equal(s.metrics.studentPairs,0);assert.equal(s.metrics.nonStudentPairs,0);assert.equal(s.optimizationStatus,'optimal');
});
