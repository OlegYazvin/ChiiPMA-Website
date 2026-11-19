const FEED='https://chipma-networking-results.mikesmythe.chatgpt.site/api/state';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,selected=0,lastVersion=-1;
const ROUND_DURATION=5*60*1000;
let timerRound=null,timerDeadline=null,timerRemaining=ROUND_DURATION,serverClockOffset=0,alarmArmed=false;
const displayMode=new URLSearchParams(location.search).has('display');
globalThis.addEventListener?.('hashchange',()=>location.reload());
// Retire old display capabilities; timer writes now stay inside the admin app.
try{sessionStorage.removeItem('chipma-timer-host');if(new URLSearchParams(location.hash.slice(1)).has('host'))history.replaceState(null,'',location.pathname+location.search);}catch{}
const TIMER_CHIME='/speed-networking-event/timer-chime.mp3?v=2';
let alarmContext=null,alarmLoading=null,alarmSource=null,alarmPlayed=false,alarmSounded=false,alarmError=false;
if(displayMode)document.body.classList.add('presentation');
function renderAudioStatus(){
 const status=$('#timer-audio-status');
 status.textContent=alarmError?'Timer sound could not load. Check the connection, then click this page to retry.':alarmContext&&alarmContext.state!=='running'?'Your browser needs one click, tap, or keypress on this page to allow audio. The chime then plays automatically after every round.':'';
 status.hidden=!status.textContent;
}
function audioUnavailable(){alarmError=true;renderAudioStatus();}
async function prepareAlarm(){
 const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;
 if(!AudioContext)throw Error('Audio is unavailable.');
 if(!alarmContext||alarmContext.state==='closed'){alarmContext=new AudioContext();alarmContext.onstatechange=renderAudioStatus;}
 // Try autoplay on load. An ordinary page interaction retries resume when the
 // browser requires user activation; there is no optional sound setting.
 const resuming=alarmContext.resume();
 renderAudioStatus();
 alarmLoading??=fetch(TIMER_CHIME,{cache:'force-cache'}).then(async response=>{
  if(!response.ok)throw Error('Timer sound could not load.');
  return alarmContext.decodeAudioData(await response.arrayBuffer());
 }).catch(error=>{alarmLoading=null;throw error;});
 const [,buffer]=await Promise.all([resuming,alarmLoading]);
 alarmError=false;renderAudioStatus();
 return buffer;
}
function primeAlarm(){
 if(alarmError&&!alarmSounded)alarmPlayed=false;
 prepareAlarm().then(()=>{if(state)renderTimer();}).catch(audioUnavailable);
}
function stopAlarm(){if(alarmSource){alarmSource.stop();alarmSource=null;}}
function playAlarm(){
 if(alarmPlayed)return;
 alarmPlayed=true;const key=timerRound;
 prepareAlarm().then(buffer=>{
  if(timerRound!==key||timerDeadline===null||state?.status!=='live'||Date.now()+serverClockOffset<timerDeadline||!alarmArmed)return;
  const source=alarmContext.createBufferSource();alarmSource=source;source.buffer=buffer;
  source.connect(alarmContext.destination);source.onended=()=>{if(alarmSource===source)alarmSource=null;};source.start();alarmSounded=true;
 }).catch(audioUnavailable);
}
function syncTimer(next){
 const key=next.currentRound>0?`${next.runId}:${next.currentRound}`:null;
 if(key!==timerRound){stopAlarm();alarmPlayed=false;alarmSounded=false;alarmArmed=false;timerRound=key;}
 if(Number.isFinite(next.serverNow))serverClockOffset=next.serverNow-Date.now();
 const timer=next.timer;timerRemaining=timer?.remainingMs??ROUND_DURATION;timerDeadline=timer?.deadlineAt??null;
 if(next.status==='live'&&timerDeadline!==null&&timerRemaining>0)alarmArmed=true;
 if(next.status!=='live')stopAlarm();
}
function renderTimer(){
 const visible=state?.currentRound>0&&['live','break'].includes(state.status);
 $('#countdown').hidden=!visible;
 $('#round-layout').classList.toggle('has-timer',visible);
 if(!visible)return;
 const remaining=Math.ceil((timerDeadline===null?timerRemaining:Math.max(0,timerDeadline-Date.now()-serverClockOffset))/1000);
 $('#timer-value').textContent=`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`;
 $('#timer-label').textContent=state.status==='break'?`Round ${state.currentRound} paused`:remaining===0?'Time is up':timerDeadline!==null?`Round ${state.currentRound} time left`:`Round ${state.currentRound} · ${timerRemaining===ROUND_DURATION?'ready':'paused'}`;
 renderAudioStatus();
 $('#countdown').classList.toggle('complete',remaining===0);
 if(state.status==='live'&&timerDeadline!==null&&remaining===0&&alarmArmed)playAlarm();
}
function render(){
 if(!state)return;const live=state.currentRound||0,hasRounds=live>0;
 renderTimer();
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
  const changed=next.version!==lastVersion;if(!state||next.currentRound!==state.currentRound)selected=next.currentRound;syncTimer(next);state=next;lastVersion=next.version;if(changed)render();else renderTimer();
  $('#connection').textContent='Updates automatically.';$('#connection').classList.remove('error');
 }catch{ $('#connection').textContent=state?'Reconnecting… Showing the last confirmed round.':'Connecting to the host… Retrying automatically.';$('#connection').classList.add('error');}
 setTimeout(poll,3000);
}
$('#name-search').oninput=render;
document.addEventListener('click',primeAlarm,{capture:true});
document.addEventListener('keydown',primeAlarm,{capture:true});
$('#round-tabs').onclick=e=>{if(e.target.dataset.round){selected=Number(e.target.dataset.round);render();}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state)render();});
setInterval(renderTimer,1000);
primeAlarm();
poll();
