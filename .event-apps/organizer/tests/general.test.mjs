import test from 'node:test';import assert from 'node:assert/strict';import loadHighs from 'highs';
import {normalizeRoster,validateSchedule} from '../lib/matching.mjs';import {generateGeneral} from '../lib/general-solver.mjs';
test('small balanced roster relaxes student separation to preserve twelve unique partners',async()=>{
 const roster=normalizeRoster(Array.from({length:14},(_,i)=>({id:`person${i}`,name:`Person ${i}`,isMpdStudent:i<7,isStudent:i<7,level:null,jobs:[],employmentStatus:null,included:true})));
 const highs=await loadHighs(),schedule=generateGeneral(roster,3,highs,()=>{},15),m=validateSchedule(roster,schedule);
 assert.equal(m.participants,14);assert.equal(m.studentPairs,18);assert.equal(schedule.optimizationStatus,'optimal');
});
