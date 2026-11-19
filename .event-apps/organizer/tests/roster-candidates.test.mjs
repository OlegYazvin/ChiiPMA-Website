import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRoster,generateFast,participants} from '../lib/matching.mjs';
import {addNonparticipant} from '../lib/roster-candidates.mjs';
import {reserveQrPeople} from '../lib/qr-slots.mjs';

const roster=normalizeRoster(Array.from({length:40},(_,i)=>({id:`synthetic${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<20,isStudent:i<20,level:'Senior',jobs:['Product Management'],employmentStatus:'Employed',included:true})));
const schedule=generateFast(roster,43);
const candidate={id:'synthetic-candidate',name:'Synthetic Candidate',isMpdStudent:false,isStudent:false,level:'Senior',jobs:['Product Management'],employmentStatus:'Employed',currentPeopleLeader:false,included:false};
const fixture=()=>({version:12,roster:structuredClone(roster),schedule:structuredClone(schedule),locked:true,pending:null,live:{status:'live',isTest:true,currentRound:1,rounds:[{number:1}]},questionBank:{questions:[{id:'synthetic-question',text:'Synthetic prompt?'}]},testQuestionAssignments:[{round:1,question_id:'synthetic-question'}]});

test('a nonparticipant can be appended without changing a locked event or its match pool',()=>{
 const state=fixture(),before=structuredClone(state),next=addNonparticipant(state,candidate);
 assert.deepEqual(state,before);
 assert.equal(next.roster.length,41);
 assert.equal(next.roster.at(-1).included,false);
 assert.equal(next.roster.at(-1).currentPeopleLeader,false);
 assert.deepEqual(next.roster.slice(0,-1),state.roster);
 assert.deepEqual(participants(next.roster),participants(state.roster));
 assert.deepEqual({...next,roster:state.roster},state);
});

test('candidate additions always default to not participating, even if included is supplied',()=>{
 const next=addNonparticipant({...fixture(),locked:false}, {...candidate,included:true});
 assert.equal(next.roster.at(-1).included,false);
 assert.equal(participants(next.roster).length,40);
});

const draftRosters={
 'an empty roster':()=>[],
 'no selected attendees':()=>roster.map(a=>({...a,included:false})),
 'partial attendance':()=>roster.map((a,i)=>({...a,included:i<4})),
 'an odd attendee count':()=>roster.map((a,i)=>({...a,included:i<15})),
 'insufficient eligible partners':()=>roster.map((a,i)=>({...a,included:i<14,teamId:'synthetic-team'})),
};
for(const [label,makeRoster] of Object.entries(draftRosters))for(const reserved of [false,true]){
 test(`an unchecked arrival can be added to ${label}${reserved?' using the next reserved QR card':''}`,()=>{
  const draft=normalizeRoster(makeRoster()),state={...fixture(),roster:reserved?normalizeRoster(reserveQrPeople(draft)):draft,schedule:null,locked:false,live:{status:'waiting',currentRound:0}},before=structuredClone(state);
  assert.throws(()=>participants(state.roster));
  const next=addNonparticipant(state,{...candidate,included:true}),added=next.roster.find(a=>a.name===candidate.name);
  assert.deepEqual(state,before);
  assert.equal(added.included,false);
  assert.equal(added.id,reserved?'qr-person-1':candidate.id);
  if(reserved){assert.equal(added.qrSlot,1);assert.equal(added.qrPending,false);}
  assert.deepEqual(next.roster.filter(a=>a.id!==added.id),state.roster.filter(a=>a.id!==added.id));
  assert.deepEqual(next.roster.filter(a=>a.included).map(a=>a.id),state.roster.filter(a=>a.included).map(a=>a.id));
  assert.deepEqual({...next,roster:state.roster},state);
 });
}

test('duplicate identities and invalid classifications are rejected',()=>{
 assert.throws(()=>addNonparticipant(fixture(),{...candidate,id:roster[0].id}),/unique/);
 assert.throws(()=>addNonparticipant(fixture(),{...candidate,name:roster[0].name}),/unique display/);
 assert.throws(()=>addNonparticipant(fixture(),{...candidate,currentPeopleLeader:true}),/leadership/);
 assert.throws(()=>addNonparticipant(fixture(),null),/Supply one/);
});

test('pending releases and implicit changes to the existing roster stay blocked',()=>{
 assert.throws(()=>addNonparticipant({...fixture(),pending:{operationId:'synthetic-pending'}},candidate),/pending round release/);
 assert.throws(()=>addNonparticipant(fixture(),{...candidate,isMpdStudent:true,isStudent:true,studentPairGroup:'first_year'}),/existing roster settings/);
});
