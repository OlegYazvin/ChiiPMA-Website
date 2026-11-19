const ROUNDS=12;
export function emptyQuestionBank(){return {schema_version:1,event_id:'speed-networking-event',round_count:ROUNDS,questions:[],round_assignments:Array.from({length:ROUNDS},(_,i)=>({round:i+1,question_id:null})),updated_at:null};}
export function normalizeQuestionBank(input=emptyQuestionBank()){
 if(!input||typeof input!=='object'||!Array.isArray(input.questions)||input.questions.length>200)throw Error('Keep up to 200 questions in the bank.');
 const ids=new Set(),questions=input.questions.map(q=>{
  if(!q||typeof q.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(q.id)||ids.has(q.id))throw Error('Each question needs a unique ID.');ids.add(q.id);
  if(typeof q.text!=='string'||!q.text.trim()||q.text.trim().length>1000)throw Error('Each question needs 1–1,000 characters.');
  return {id:q.id,text:q.text.trim(),source:'event_organizer',created_at:typeof q.created_at==='string'&&q.created_at.length<=50?q.created_at:null};
 });
 if(!Array.isArray(input.round_assignments)||input.round_assignments.length!==ROUNDS)throw Error('Provide one question assignment slot for each of the twelve rounds.');
 const seen=new Set(),assigned=new Set(),round_assignments=input.round_assignments.map(a=>{
  if(!a||!Number.isInteger(a.round)||a.round<1||a.round>ROUNDS||seen.has(a.round))throw Error('Question round numbers must be unique numbers from 1 through 12.');seen.add(a.round);
  const question_id=a.question_id??null;if(question_id!==null&&!ids.has(question_id))throw Error('A round refers to a question that is no longer in the bank.');if(question_id)assigned.add(question_id);
  return {round:a.round,question_id};
 }).sort((a,b)=>a.round-b.round);
 return {...emptyQuestionBank(),questions:questions.map(q=>({...q,status:assigned.has(q.id)?'selected':'candidate'})),round_assignments,updated_at:typeof input.updated_at==='string'&&input.updated_at.length<=50?input.updated_at:null};
}
export function questionForRound(bank,round){const id=bank?.round_assignments?.find(a=>a.round===round)?.question_id;return bank?.questions?.find(q=>q.id===id)?.text??null;}
export function effectiveQuestionIdForRound(state,round,isTest=state.live?.isTest===true){return state.questionBank?.round_assignments?.find(a=>a.round===round)?.question_id||(isTest?state.testQuestionAssignments?.find(a=>a.round===round)?.question_id:null)||null;}
export function effectiveQuestionForRound(state,round,isTest=state.live?.isTest===true){const id=effectiveQuestionIdForRound(state,round,isTest);return state.questionBank?.questions?.find(q=>q.id===id)?.text??null;}
export function randomTestQuestionAssignments(input,{previous=null,releasedRound=0,random=Math.random}={}){
 const bank=normalizeQuestionBank(input),ids=bank.questions.map(q=>q.id),valid=new Set(ids),used=new Set(bank.round_assignments.map(a=>a.question_id).filter(Boolean));
 const old=new Map((previous||[]).map(a=>[a.round,a.question_id])),assignments=bank.round_assignments.map(a=>({...a}));
 for(const a of assignments)if(a.round<=releasedRound){a.question_id=a.question_id||old.get(a.round)||null;if(a.question_id)used.add(a.question_id);}
 for(const a of assignments)if(a.round>releasedRound&&!a.question_id){const id=old.get(a.round);if(valid.has(id)&&!used.has(id)){a.question_id=id;used.add(id);}}
 const shuffle=items=>{items=[...items];for(let i=items.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;};
 const unused=shuffle(ids.filter(id=>!used.has(id)));let repeats=[];
 for(const a of assignments)if(a.round>releasedRound&&!a.question_id&&ids.length){if(unused.length)a.question_id=unused.pop();else{if(!repeats.length)repeats=shuffle(ids);a.question_id=repeats.pop();}}
 return assignments;
}
export function validateQuestionChange(previous,next,live={currentRound:0},testAssignments=null){
 const old=normalizeQuestionBank(previous),bank=normalizeQuestionBank(next),released=live.currentRound||0;
 for(let round=1;round<=released;round++){
  const before=old.round_assignments[round-1].question_id,after=bank.round_assignments[round-1].question_id;
  const testId=live.isTest?testAssignments?.find(a=>a.round===round)?.question_id:null,id=before||testId;
  if(before!==after||old.questions.find(q=>q.id===id)?.text!==bank.questions.find(q=>q.id===id)?.text)throw Error('Questions for released rounds are locked. You can edit upcoming rounds or add a new question.');
 }
 return bank;
}
