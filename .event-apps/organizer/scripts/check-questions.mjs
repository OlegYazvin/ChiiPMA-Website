// Synthetic, local-only rehearsal of the question bank and released display.
import assert from 'node:assert/strict';
import {normalizeRoster} from '../lib/matching.mjs';import {alternatingBaseline} from '../lib/alternating-solver.mjs';import {emptyQuestionBank} from '../lib/question-bank.mjs';
const admin='http://127.0.0.1:8797',display='http://127.0.0.1:8798';
async function req(base,path,body,headers={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{...headers,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};}
const roster=normalizeRoster(Array.from({length:40},(_,i)=>({id:`synthetic${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<20,isStudent:i<20,level:'Senior',jobs:[],employmentStatus:'Employed',included:true,studentPairAnchor:i===0,alternateStudentPartners:i===0}))),schedule=alternatingBaseline(roster,39);
let response=await req(admin,'/api/initialize',{roster,schedule});assert.equal(response.status,200,JSON.stringify(response.data));let state=response.data;
async function control(action){const r=await req(admin,'/api/control',{expectedVersion:state.version,action});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;return state;}
async function save(bank){const r=await req(admin,'/api/questions',{expectedVersion:state.version,questionBank:bank});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data;assert.deepEqual(state.roster,roster);assert.equal(state.schedule.id,schedule.id);return state;}
// An unassigned bank gets a temporary twelve-question plan for rehearsal.
{
 const randomBank={...emptyQuestionBank(),questions:Array.from({length:18},(_,i)=>({id:`sample${i+1}`,text:`Random synthetic prompt ${i+1}?`}))};await save(randomBank);
 const originalSelections=structuredClone(state.questionBank.round_assignments);await control('startTest');
 assert.equal(state.testQuestionAssignments.length,12);assert.equal(new Set(state.testQuestionAssignments.map(a=>a.question_id)).size,12);assert.deepEqual(state.questionBank.round_assignments,originalSelections);
 let shown=await req(display,'/api/state');assert(shown.data.rounds[0].leadQuestion);assert(shown.data.isTest);assert(!JSON.stringify(shown.data).includes('testQuestionAssignments'));
 const firstId=state.testQuestionAssignments[0].question_id,futureId=state.testQuestionAssignments[1].question_id;
 const illegal=structuredClone(state.questionBank);illegal.questions.find(q=>q.id===firstId).text='Changed released random prompt';assert.equal((await req(admin,'/api/questions',{expectedVersion:state.version,questionBank:illegal})).status,400);
 const edited=structuredClone(state.questionBank);edited.questions.find(q=>q.id===futureId).text='Revised random future prompt';await save(edited);assert.deepEqual(state.questionBank.round_assignments,originalSelections);
 await control('next');shown=await req(display,'/api/state');assert.equal(shown.data.rounds[1].leadQuestion,'Revised random future prompt');
 await control('resetTest');assert.equal(state.testQuestionAssignments,null);assert.deepEqual(state.questionBank.round_assignments,originalSelections);shown=await req(display,'/api/state');assert.deepEqual(shown.data.rounds,[]);
}
const bank={...emptyQuestionBank(),questions:[{id:'q1',text:'Synthetic first question?'},{id:'q2',text:'Synthetic future question?'},{id:'unused',text:'Synthetic unused candidate - never public'}]};bank.round_assignments[0].question_id='q1';bank.round_assignments[1].question_id='q2';bank.round_assignments[11].question_id='q2';await save(bank);
response=await req(display,'/api/state');assert.equal(response.data.currentRound,0);assert(!JSON.stringify(response.data).includes('question'));
await control('startTest');assert(state.locked);response=await req(display,'/api/state');assert.equal(response.data.rounds[0].leadQuestion,'Synthetic first question?');assert(!JSON.stringify(response.data).includes('Synthetic future'));assert(!JSON.stringify(response.data).includes('never public'));
let revised=structuredClone(state.questionBank);revised.questions[1].text='Revised upcoming question?';await save(revised);assert(state.locked);
const frozenVersion=state.version,bad=structuredClone(state.questionBank);bad.questions[0].text='Changed released question';response=await req(admin,'/api/questions',{expectedVersion:state.version,questionBank:bad});assert.equal(response.status,400);assert.match(response.data.error,/released rounds are locked/);
const badAssignment=structuredClone(state.questionBank);badAssignment.round_assignments[0].question_id='q2';assert.equal((await req(admin,'/api/questions',{expectedVersion:state.version,questionBank:badAssignment})).status,400);
response=await req(admin,'/api/state');assert.equal(response.data.version,frozenVersion);
await control('next');response=await req(display,'/api/state');assert.equal(response.data.rounds[1].leadQuestion,'Revised upcoming question?');assert.equal(response.data.rounds[0].leadQuestion,'Synthetic first question?');
await control('resetTest');response=await req(display,'/api/state');assert.equal(response.data.status,'waiting');assert.deepEqual(response.data.rounds,[]);assert.equal(state.questionBank.round_assignments[11].question_id,'q2');assert.equal(state.testQuestionAssignments,null);
revised=structuredClone(state.questionBank);revised.questions[0].text='Revised after reset';await save(revised);
const preserved=structuredClone(state.questionBank);response=await req(admin,'/api/save',{expectedVersion:state.version,roster,schedule:state.schedule});assert.equal(response.status,200);state=response.data;assert.deepEqual(state.questionBank,preserved);
assert.equal((await req(admin,'/api/questions',{expectedVersion:state.version-1,questionBank:preserved})).status,409);
assert.equal((await req(admin,'/api/questions',{expectedVersion:state.version,questionBank:preserved},{Origin:'https://untrusted.example'})).status,403);
await control('start');assert(state.locked&&!state.live.isTest);assert.equal(state.testQuestionAssignments,null);revised=structuredClone(state.questionBank);revised.questions[1].text='Chosen during the real event';await save(revised);
for(let round=2;round<=12;round++)await control('next');await control('finish');response=await req(display,'/api/state');assert.equal(response.data.rounds[11].leadQuestion,'Chosen during the real event');assert.equal(response.data.rounds[0].leadQuestion,'Revised after reset');
for(const forbidden of ['never public','questionBank','question_id','round_assignments','employmentStatus','isMpdStudent'])assert(!JSON.stringify(response.data).includes(forbidden));
assert.equal((await req(display,'/api/publish',{})).status,401);
console.log('Passed local end-to-end: random test questions are temporary and distinct; reset restores real selections; question saves preserve matches; drafts stay private; live future rounds editable; released questions locked; reset unlocks questions; regeneration preserves assignments; sequential public releases carry only the chosen questions.');
