import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveQrPeople,validateQrSlots} from '../lib/qr-slots.mjs';
import {addNonparticipant} from '../lib/roster-candidates.mjs';
import {normalizeRoster,participants,generateFast,validateSchedule} from '../lib/matching.mjs';
import {assignExistingQrCard,reservedCardRows,validateExistingQrAssignments} from '../lib/reserved-card-assignment.mjs';
const fixture=()=>{const roster=normalizeRoster(Array.from({length:28},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<14,isStudent:i<14,level:'Senior',jobs:[],employmentStatus:'Employed',included:true})));return {roster,schedule:generateFast(roster,29),locked:true,pending:null};};
test('three reserved identities can be created idempotently without changing any matches',()=>{
 const s=fixture(),roster=normalizeRoster(reserveQrPeople(s.roster));assert.equal(roster.length,31);assert.deepEqual(roster.slice(0,28),s.roster);assert.deepEqual(reserveQrPeople(roster),roster);assert.deepEqual(participants(roster),participants(s.roster));validateSchedule(roster,s.schedule);
 assert.deepEqual(roster.slice(-3).map(a=>[a.id,a.name,a.qrSlot,a.qrPending,a.included]),[['qr-person-1','Person 1',1,true,false],['qr-person-2','Person 2',2,true,false],['qr-person-3','Person 3',3,true,false]]);
});
test('the first three new names claim slots in order, remain unchecked, and preserve the schedule',()=>{
 let state=fixture();state.roster=normalizeRoster(reserveQrPeople(state.roster));const schedule=structuredClone(state.schedule);
 for(let n=1;n<=4;n++){state=addNonparticipant(state,{id:`new-${n}`,name:`New Synthetic ${n}`,isMpdStudent:false,isStudent:false,level:null,jobs:[],employmentStatus:null,included:true});const person=state.roster.find(a=>a.name===`New Synthetic ${n}`);assert.equal(person.id,n<=3?`qr-person-${n}`:`new-${n}`);assert.equal(person.included,false);if(n<=3){assert.equal(person.qrSlot,n);assert.equal(person.qrPending,false);}assert.deepEqual(state.schedule,schedule);validateSchedule(state.roster,state.schedule);}
 assert.equal(state.roster.length,32);assert.equal(participants(state.roster).length,28);
});
test('QR markers survive export/import, and assigned cards cannot be removed or reset',()=>{
 let s=fixture();s.roster=normalizeRoster(reserveQrPeople(s.roster));s=addNonparticipant(s,{id:'new-1',name:'New Person',isMpdStudent:false,isStudent:false,level:null,jobs:[],employmentStatus:null});const imported=normalizeRoster(JSON.parse(JSON.stringify(s.roster)));assert.deepEqual(imported,s.roster);validateQrSlots(s.roster,imported);
 assert.throws(()=>validateQrSlots(s.roster,imported.filter(a=>a.id!=='qr-person-1')),/Keep reserved/);
 assert.throws(()=>validateQrSlots(s.roster,imported.map(a=>a.id==='qr-person-1'?{...a,qrPending:true}:a)),/cannot be reset/);
 assert.throws(()=>normalizeRoster(imported.map(a=>a.qrPending?{...a,included:true}:a)),/Name the reserved card/);
});
test('duplicate names fail without consuming a reserved card',()=>{
 const s=fixture();s.roster=normalizeRoster(reserveQrPeople(s.roster));assert.throws(()=>addNonparticipant(s,{id:'new-1',name:s.roster[0].name}),/unique/);assert.equal(s.roster.filter(a=>a.qrPending).length,3);
});
test('assigning an existing attendee changes only the spare-card mapping, even when matches are frozen',()=>{
 const original=fixture();original.roster=normalizeRoster(reserveQrPeople(original.roster));original.questionBank={test:'unchanged'};
 const s=assignExistingQrCard(original,2,original.roster[0].id);
 assert.deepEqual(s,{...original,qrAssignments:{2:original.roster[0].id}});
 assert.equal(s.roster,original.roster);assert.equal(s.schedule,original.schedule);assert.equal(s.locked,true);
 assert.deepEqual(reservedCardRows(s).find(a=>a.qrSlot===2),{id:'qr-person-2',name:original.roster[0].name,qrSlot:2,qrPending:false,participantId:original.roster[0].id});
 assert.throws(()=>assignExistingQrCard(s,2,original.roster[1].id),/unassigned/);
 assert.throws(()=>assignExistingQrCard(s,1,original.roster[0].id),/already has/);
 assert.throws(()=>assignExistingQrCard(s,1,'missing-id'),/existing attendee/);
 assert.throws(()=>assignExistingQrCard(s,1,'qr-person-3'),/existing attendee/);
 assert.throws(()=>assignExistingQrCard({...s,pending:{}},1,original.roster[1].id),/pending/);
 assert.throws(()=>validateExistingQrAssignments({...s,roster:s.roster.filter(a=>a.id!==original.roster[0].id)}),/linked/);
});
test('new arrivals skip cards linked to existing attendees, and the linked attendee stays unchanged',()=>{
 const original=fixture();original.roster=normalizeRoster(reserveQrPeople([...original.roster,{...original.roster[0],id:'not-participating',name:'Existing Nonparticipant',included:false}]));
 let state=assignExistingQrCard(original,1,'not-participating');
 for(let n=1;n<=3;n++)state=addNonparticipant(state,{id:`new-${n}`,name:`Another New Person ${n}`,isMpdStudent:false,isStudent:false,level:null,jobs:[],employmentStatus:null});
 assert.deepEqual(state.roster.find(a=>a.id==='not-participating'),original.roster.find(a=>a.id==='not-participating'));
 assert.equal(state.roster.find(a=>a.name==='Another New Person 1').id,'qr-person-2');
 assert.equal(state.roster.find(a=>a.name==='Another New Person 2').id,'qr-person-3');
 assert.equal(state.roster.find(a=>a.name==='Another New Person 3').id,'new-3');
 assert.deepEqual(state.qrAssignments,{1:'not-participating'});assert.deepEqual(state.schedule,original.schedule);
 validateExistingQrAssignments(state);validateSchedule(state.roster,state.schedule);
});
