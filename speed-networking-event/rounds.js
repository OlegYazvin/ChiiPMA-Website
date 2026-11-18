const FEED='https://chipma-networking-results.mikesmythe.chatgpt.site/api/state';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,selected=0,lastVersion=-1;
if(new URLSearchParams(location.search).has('display'))document.body.classList.add('presentation');
function render(){
 if(!state)return;const live=state.currentRound||0,hasRounds=live>0;
 $('#test-banner').hidden=!state.isTest;document.body.classList.toggle('is-test',!!state.isTest);
 $('#event-status').textContent={waiting:'WAITING',live:'ROUND IN PROGRESS',break:'BREAK',finished:'EVENT COMPLETE'}[state.status]||'WAITING';
 $('#round-label').textContent=state.status==='waiting'?'Waiting for round 1':state.status==='finished'?'All 12 rounds complete':state.status==='break'?`On a break after round ${live}`:`Round ${live} of 12`;
 $('#round-counter').textContent=hasRounds?`${state.isTest?'TEST · ':''}${live} of 12 rounds released`:'12 rounds · Stations 1–20';
 $('#waiting').hidden=hasRounds;$('#search-wrap').hidden=!hasRounds;$('#round-tabs').hidden=!hasRounds;$('#history').hidden=!hasRounds;$('#table-wrap').hidden=!hasRounds;
 $('#round-tabs').innerHTML=(state.rounds||[]).map(r=>`<button data-round="${r.number}" class="${selected===r.number?'selected':''}" aria-pressed="${selected===r.number}">Round ${r.number}</button>`).join('');
 $('#section-eyebrow').textContent=hasRounds?selected===live?'CURRENT ROUND':'PREVIOUS ROUND':'CURRENT ROUND';
 $('#section-title').textContent=hasRounds?`Round ${selected}: Station assignments`:'Stations and partners';
 const query=$('#name-search').value.trim().toLocaleLowerCase(),r=state.rounds?.find(r=>r.number===selected);
 $('#lead-question').hidden=!r?.leadQuestion;$('#lead-question-text').textContent=r?.leadQuestion||'';
 const pairs=(r?.matches||[]).filter(p=>!query||p.names.some(n=>n.toLocaleLowerCase().includes(query)));
 $('#pair-grid').innerHTML=pairs.map(p=>`<tr class="${query?'highlight':''}"><th scope="row">${String(p.station??p.pairNumber).padStart(2,'0')}</th><td>${esc(p.names[0])}</td><td>${esc(p.names[1])}</td></tr>`).join('');
 $('#no-results').hidden=!hasRounds||pairs.length>0;
}
async function poll(){
 try{
  const r=await fetch(FEED,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Display unavailable');const next=await r.json();
  if(!Array.isArray(next.rounds)||!['waiting','live','break','finished'].includes(next.status))throw Error('Invalid display');
  if(next.version!==lastVersion){if(!state||next.currentRound!==state.currentRound)selected=next.currentRound;state=next;lastVersion=next.version;render();}
  $('#connection').textContent='Updates automatically.';$('#connection').classList.remove('error');
 }catch{ $('#connection').textContent=state?'Reconnecting… Showing the last confirmed round.':'Connecting to the host… Retrying automatically.';$('#connection').classList.add('error');}
 setTimeout(poll,3000);
}
$('#name-search').oninput=render;
$('#round-tabs').onclick=e=>{if(e.target.dataset.round){selected=Number(e.target.dataset.round);render();}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state)render();});
poll();
