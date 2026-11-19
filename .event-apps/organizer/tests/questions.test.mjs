import test from 'node:test';import assert from 'node:assert/strict';
import {emptyQuestionBank,normalizeQuestionBank,validateQuestionChange,questionForRound} from '../lib/question-bank.mjs';
import {publicSnapshot} from '../lib/event-snapshot.mjs';import {sanitizePublicState,validateTransition,waitingState} from '../lib/public-state.mjs';
const bank=()=>({...emptyQuestionBank(),questions:[{id:'q1',text:'First synthetic question?'},{id:'q2',text:'Second synthetic question?'}]});
const event=()=>({roster:[{id:'a',name:'A',employmentStatus:'private'},{id:'b',name:'B'}],questionBank:bank(),schedule:{rounds:[{number:1,pairs:[['a','b']],stations:[2]},{number:2,pairs:[['a','b']],stations:[1]}]},live:waitingState()});
test('question bank supports twelve nullable assignments, stable IDs, trimming, and selected status',()=>{const b=bank();b.questions[0].text='  First synthetic question?  ';b.round_assignments[2].question_id='q1';const n=normalizeQuestionBank(b);assert.equal(n.round_assignments.length,12);assert.equal(n.questions[0].text,'First synthetic question?');assert.equal(n.questions[0].status,'selected');assert.equal(n.questions[1].status,'candidate');assert.equal(questionForRound(n,3),'First synthetic question?');assert.equal(questionForRound(n,1),null);assert.equal(normalizeQuestionBank().questions.length,0);});
test('invalid question IDs, text, references, and round numbers are rejected',()=>{
 for(const mutate of [b=>b.questions.push({...b.questions[0]}),b=>b.questions[0].text=' ',b=>b.questions[0].text='x'.repeat(1001),b=>b.round_assignments[0].question_id='missing',b=>b.round_assignments[1].round=1,b=>b.round_assignments.pop()]){const b=bank();mutate(b);assert.throws(()=>normalizeQuestionBank(b));}
});
test('future questions remain editable during a locked live event; released assignments and text cannot change',()=>{
 const old=bank();old.round_assignments[0].question_id='q1';old.round_assignments[1].question_id='q2';const live={currentRound:1,status:'live'},next=structuredClone(old);next.questions[1].text='Revised upcoming question?';next.round_assignments[11].question_id='q2';assert.doesNotThrow(()=>validateQuestionChange(old,next,live));
 const changed=structuredClone(next);changed.questions[0].text='Changed past question?';assert.throws(()=>validateQuestionChange(old,changed,live),/released rounds are locked/);
 const unassigned=structuredClone(next);unassigned.round_assignments[0].question_id=null;assert.throws(()=>validateQuestionChange(old,unassigned,live),/released rounds are locked/);
 assert.doesNotThrow(()=>validateQuestionChange(old,changed,waitingState()));
});
test('public snapshots release only assigned questions and never the candidate bank or future assignments',()=>{
 const s=event();s.questionBank.round_assignments[0].question_id='q1';s.questionBank.round_assignments[1].question_id='q2';const p=publicSnapshot(s,'live',1);assert.equal(p.rounds[0].leadQuestion,'First synthetic question?');assert(!JSON.stringify(p).includes('Second synthetic'));for(const key of ['questionBank','question_id','round_assignments','employmentStatus'])assert(!JSON.stringify(p).includes(key));assert.equal(publicSnapshot(event(),'live',1).rounds[0].leadQuestion,undefined);
});
test('released question snapshots remain immutable even if a bank entry is later changed',()=>{
 const s=event();s.questionBank.round_assignments[0].question_id='q1';s.live=publicSnapshot(s,'live',1);s.questionBank.questions[0].text='Different future text';assert.equal(publicSnapshot(s,'break',1).rounds[0].leadQuestion,'First synthetic question?');
});
test('results whitelist accepts only a bounded optional question and prevents released question changes',()=>{
 const s=event();s.questionBank.round_assignments[0].question_id='q1';const p=sanitizePublicState(publicSnapshot(s,'live',1));assert.equal(p.rounds[0].leadQuestion,'First synthetic question?');const bad=structuredClone(p);bad.rounds[0].leadQuestion='Changed question';assert.throws(()=>validateTransition(p,bad),/immutable/);
 for(const value of [42,'','x'.repeat(1001)]){const b=structuredClone(p);b.rounds[0].leadQuestion=value;assert.throws(()=>sanitizePublicState(b),/Invalid lead question/);}
 const extra=structuredClone(p);extra.rounds[0].questionBank={private:'never'};assert(!JSON.stringify(sanitizePublicState(extra)).includes('never'));
});
const {randomTestQuestionAssignments,effectiveQuestionForRound}=await import('../lib/question-bank.mjs');
const manyQuestions=()=>({...emptyQuestionBank(),questions:Array.from({length:18},(_,i)=>({id:`random${i+1}`,text:`Synthetic candidate ${i+1}?`}))});
test('test randomization fills twelve slots without repeats and never modifies saved selections',()=>{
 const b=manyQuestions();b.round_assignments[3].question_id='random4';b.round_assignments[11].question_id='random12';const before=structuredClone(b),assignments=randomTestQuestionAssignments(b,{random:()=>0.25});
 assert.deepEqual(b,before);assert.equal(assignments.length,12);assert(assignments.every(a=>a.question_id));assert.equal(new Set(assignments.map(a=>a.question_id)).size,12);assert.equal(assignments[3].question_id,'random4');assert.equal(assignments[11].question_id,'random12');
 const state={questionBank:b,testQuestionAssignments:assignments,live:{isTest:true}};assert(effectiveQuestionForRound(state,1));assert.equal(effectiveQuestionForRound(state,1,false),null);assert.equal(effectiveQuestionForRound(state,4,false),'Synthetic candidate 4?');
});
test('tests can reuse a small bank and safely leave blanks only when no candidates exist',()=>{
 const few=bank(),assignments=randomTestQuestionAssignments(few,{random:()=>0});assert(assignments.every(a=>['q1','q2'].includes(a.question_id)));assert(randomTestQuestionAssignments(emptyQuestionBank()).every(a=>a.question_id===null));
});
test('test-plan updates preserve released choices and replace deleted or manually overridden future candidates',()=>{
 const b=manyQuestions(),previous=randomTestQuestionAssignments(b,{random:()=>0.5}),deleted=previous[5].question_id;const next=structuredClone(b);next.questions=next.questions.filter(q=>q.id!==deleted);next.round_assignments[7].question_id='random18';
 const updated=randomTestQuestionAssignments(next,{previous,releasedRound:2,random:()=>0});assert.deepEqual(updated.slice(0,2),previous.slice(0,2));assert.equal(updated[7].question_id,'random18');assert(!updated.some(a=>a.question_id===deleted));assert(updated.every(a=>a.question_id));assert.equal(new Set(updated.map(a=>a.question_id)).size,12);
});
test('randomly released test questions are locked even though their real assignment remains blank',()=>{
 const b=manyQuestions(),assignments=randomTestQuestionAssignments(b,{random:()=>0.25}),live={currentRound:1,isTest:true},used=assignments[0].question_id,bad=structuredClone(b);bad.questions.find(q=>q.id===used).text='Changed released test text';assert.throws(()=>validateQuestionChange(b,bad,live,assignments),/released rounds are locked/);
 const future=structuredClone(b);future.questions.find(q=>q.id===assignments[1].question_id).text='Edited future text';assert.doesNotThrow(()=>validateQuestionChange(b,future,live,assignments));assert.doesNotThrow(()=>validateQuestionChange(b,bad,waitingState(),null));
});
test('only test snapshots use temporary randomized questions, including the initial release from waiting',()=>{
 const state=event();state.questionBank=manyQuestions();state.testQuestionAssignments=randomTestQuestionAssignments(state.questionBank,{random:()=>0.5});const tested=publicSnapshot(state,'live',1,true),real=publicSnapshot(state,'live',1,false);assert(tested.rounds[0].leadQuestion);assert.equal(real.rounds[0].leadQuestion,undefined);assert(!JSON.stringify(tested).includes('testQuestionAssignments'));
});
