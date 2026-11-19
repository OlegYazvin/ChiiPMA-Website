import {emptyQuestionBank,effectiveQuestionIdForRound,effectiveQuestionForRound} from './question-bank.mjs?v=2';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value);
export function mountQuestionBank({getState,save,onSaved,notice,onBusyChange,onDirtyChange,isEventBusy}){
 let draft=null,dirty=false,busy=false;
 const saved=()=>getState()?.questionBank||emptyQuestionBank();
 const released=()=>getState()?.live?.currentRound||0;
 function markDirty(){const first=!dirty;dirty=true;sync();if(first)onDirtyChange();}
 function effectiveState(){return {...getState(),questionBank:draft};}
 function lockedIds(){return new Set(Array.from({length:released()},(_,i)=>effectiveQuestionIdForRound(effectiveState(),i+1)).filter(Boolean));}
 function sync(){
  $('#question-save-status').textContent=dirty?'Changes not saved':'All changes saved';
  $('#save-questions').disabled=!dirty||busy||isEventBusy()||!!getState()?.pending;
  $('#discard-questions').disabled=!dirty||busy;
  $('#question-count').textContent=draft?.questions.length??0;
 }
 function updateLabels(){
  const questions=new Map(draft.questions.map(q=>[q.id,q.text]));
  $('#question-assignments').querySelectorAll('option[data-question-id]').forEach(el=>{const text=questions.get(el.dataset.questionId)||'(Enter a question)';el.textContent=text.length>120?text.slice(0,117)+'…':text;});
  $('#question-assignments').querySelectorAll('[data-question-preview]').forEach(el=>{el.textContent=effectiveQuestionForRound(effectiveState(),Number(el.dataset.questionPreview))||'';});
 }
 function render(){
  if(!getState())return;if(!draft||!dirty)draft=clone(saved());const used=lockedIds(),disabled=busy||isEventBusy()||!!getState().pending;
  $('#question-list').innerHTML=draft.questions.map((q,i)=>{const rounds=draft.round_assignments.filter(a=>a.question_id===q.id).map(a=>a.round),locked=used.has(q.id);return `<article class="question-card"><div class="question-card-heading"><label for="question-${esc(q.id)}">Question ${i+1}</label><span>${locked?'Released · Locked':rounds.length?`Assigned to round${rounds.length>1?'s':''} ${rounds.join(', ')}`:'Candidate'}</span></div><textarea id="question-${esc(q.id)}" data-question-id="${esc(q.id)}" maxlength="1000" rows="3"${locked?' readonly':''}${disabled?' disabled':''}>${esc(q.text)}</textarea><button class="question-remove" data-remove-question="${esc(q.id)}"${disabled||rounds.length||locked?' disabled':''} title="${rounds.length?'Unassign this question before removing it':'Remove this candidate question'}">Remove</button></article>`;}).join('')||'<p class="muted">Add a question to start your bank.</p>';
  $('#question-assignments').innerHTML=draft.round_assignments.map(a=>{const locked=a.round<=released(),text=effectiveQuestionForRound(effectiveState(),a.round);return `<div class="question-round"><div class="question-round-heading"><label for="round-question-${a.round}">Round ${a.round}</label>${locked?'<span>Released · Locked</span>':getState().live?.isTest&&!a.question_id&&text?'<span>Random for test</span>':''}</div><select id="round-question-${a.round}" data-question-round="${a.round}" aria-label="Lead question for round ${a.round}"${disabled||locked?' disabled':''}><option value=""${a.question_id===null?' selected':''}>No question assigned</option>${draft.questions.map(q=>`<option value="${esc(q.id)}" data-question-id="${esc(q.id)}"${a.question_id===q.id?' selected':''}>${esc(q.text.length>120?q.text.slice(0,117)+'…':q.text)}</option>`).join('')}</select><p data-question-preview="${a.round}">${esc(text||'')}</p></div>`;}).join('');
  $('#new-question').disabled=disabled;$('#add-question button').disabled=disabled;
  $('#question-lock-note').textContent=getState().live?.isTest?'Test run: blank round selections use temporary random questions. Manual selections are saved for the real event. Reset test removes the temporary assignments.':released()?`Rounds 1–${released()} are released. You can still edit and assign questions for upcoming rounds.`:'Assign one question per round whenever you are ready. Questions appear publicly only when their round is released.';
  sync();
 }
 $('#question-list').addEventListener('input',e=>{const id=e.target.dataset.questionId;if(!id||lockedIds().has(id))return;const q=draft.questions.find(q=>q.id===id);if(q){q.text=e.target.value;markDirty();updateLabels();}});
 $('#question-list').addEventListener('click',e=>{const id=e.target.closest?.('[data-remove-question]')?.dataset.removeQuestion;if(!id||lockedIds().has(id)||draft.round_assignments.some(a=>a.question_id===id))return;draft.questions=draft.questions.filter(q=>q.id!==id);markDirty();render();});
 $('#question-assignments').addEventListener('change',e=>{const round=Number(e.target.dataset.questionRound);if(!round||round<=released())return;draft.round_assignments.find(a=>a.round===round).question_id=e.target.value||null;markDirty();render();});
 $('#add-question').onsubmit=e=>{e.preventDefault();const text=$('#new-question').value.trim();if(!text||busy)return;draft.questions.push({id:crypto.randomUUID(),text,status:'candidate',source:'event_organizer',created_at:new Date().toISOString()});$('#new-question').value='';markDirty();render();};
 $('#discard-questions').onclick=()=>{dirty=false;draft=clone(saved());render();onDirtyChange();};
 $('#save-questions').onclick=async()=>{if(!dirty||busy)return;busy=true;onBusyChange();render();try{const next=await save(draft);dirty=false;draft=clone(next.questionBank);onSaved(next);notice('Question bank and round assignments saved.');}catch(error){notice(error.message,true);}finally{busy=false;onBusyChange();render();}};
 return {render,get dirty(){return dirty;},get busy(){return busy;}};
}
