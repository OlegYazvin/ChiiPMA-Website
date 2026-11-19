import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeRoster,generateFast,circleSchedule,validateSchedule,participants} from '../lib/matching.mjs';
import {assignStations,minimumAssignment} from '../lib/stations.mjs';
import {sanitizePublicState} from '../lib/public-state.mjs';
const roster=(s,n)=>normalizeRoster(Array.from({length:s+n},(_,i)=>({id:`p${String(i).padStart(2,'0')}`,name:`Person ${i}`,isMpdStudent:i<s,isStudent:i<s,level:null,jobs:[],employmentStatus:null,included:true,studentPairAnchor:i===s-1})));
test('forty people use all twenty stations and the same twenty students stay all event',()=>{
 const r=roster(20,20),original=generateFast(r,88),s=assignStations(original,r),m=validateSchedule(r,s);
 assert.equal(m.stationStays,220);assert.equal(m.maximumStationStays,220);assert.equal(m.stationMovements,220);assert.equal(m.stationaryAttendeeIds.length,20);
 assert(m.stationaryAttendeeIds.every(id=>r.find(a=>a.id===id).isMpdStudent));
 for(let i=0;i<12;i++){
  assert.deepEqual(s.rounds[i].stations,Array.from({length:20},(_,j)=>j+1));
  assert.deepEqual(s.rounds[i].pairs.map(p=>[...p].sort().join(':')).sort(),original.rounds[i].pairs.map(p=>[...p].sort().join(':')).sort());
 }
 assert.deepEqual(assignStations(s,r),s);
});
test('thirty-eight people keep nineteen stations active and one physical station idle',()=>{const r=roster(20,18),s=assignStations(generateFast(r,2),r),m=validateSchedule(r,s);assert.equal(m.activeStations,19);assert.equal(m.stationStays,209);assert.equal(m.stationaryAttendeeIds.length,19);assert(s.rounds.every(rd=>!rd.stations.includes(20)));});
test('non-bipartite conversations attain the retention bound without changing any pairs',()=>{const r=roster(7,7),base=circleSchedule(r,44),s=assignStations(base,r),m=validateSchedule(r,s);assert.equal(s.stationPlan.anchors.length,0);assert.equal(m.stationStays,77);assert.equal(m.maximumStationStays,77);assert.deepEqual(assignStations(s,r),s);});
test('station assignment matches exhaustive search on independent four-by-four cost matrices',()=>{
 function permutations(xs){return xs.length?xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>j!==i)).map(p=>[x,...p])):[[]];}
 for(let trial=0;trial<20;trial++){const c=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>((trial+3)*(i+2)*(j+1)+i*7-j*11)%23));const a=minimumAssignment(c),score=p=>p.reduce((v,j,i)=>v+c[i][j],0);assert.equal(score(a),Math.min(...permutations([0,1,2,3]).map(score)));}
});
test('invalid station ranges, duplicate stations, and rosters beyond capacity are rejected',()=>{
 const r=roster(20,20),s=assignStations(generateFast(r,2),r);
 for(const invalid of [0,22,1]){const bad=structuredClone(s);bad.rounds[0].stations[1]=invalid;assert.throws(()=>validateSchedule(r,bad),/Stations/);}
 const missing=structuredClone(s);missing.rounds[1].stations.pop();assert.throws(()=>validateSchedule(r,missing),/Every conversation/);
 assert.throws(()=>participants(roster(22,22)),/21 stations/);
});
test('public results preserve station numbers and reject collisions and out-of-range stations',()=>{
 const s={eventId:'chipma-2026-11-19',status:'live',currentRound:1,rounds:[{number:1,matches:[{station:20,names:['A','B']},{station:1,names:['C','D']}]}]};
 assert.equal(sanitizePublicState(s).rounds[0].matches[0].station,20);
 for(const invalid of [0,22,20]){const bad=structuredClone(s);bad.rounds[0].matches[1].station=invalid;assert.throws(()=>sanitizePublicState(bad),/Stations/);}
});

test('forty-two people use all twenty-one stations through all twelve released rounds',()=>{
 const r=roster(21,21),s=assignStations(generateFast(r,91),r),m=validateSchedule(r,s);
 assert.equal(m.participants,42);assert.equal(m.activeStations,21);assert.equal(m.stationCount,21);assert.equal(m.stationStays,231);
 assert.equal(m.stationaryAttendeeIds.length,21);
 for(const round of s.rounds)assert.deepEqual(round.stations,Array.from({length:21},(_,i)=>i+1));
 const names=new Map(r.map(a=>[a.id,a.name]));
 const released={eventId:'chipma-2026-11-19',status:'finished',currentRound:12,rounds:s.rounds.map(round=>({number:round.number,matches:round.pairs.map((pair,i)=>({station:round.stations[i],names:pair.map(id=>names.get(id))}))}))};
 const sanitized=sanitizePublicState(released);
 assert(sanitized.rounds.every(round=>round.matches.length===21&&round.matches.some(match=>match.station===21)));
});
