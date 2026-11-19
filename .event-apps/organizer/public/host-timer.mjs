export const LIVE_DISPLAY='https://www.chipma.org/speed-networking-event/?display=1';
export function mountHostTimer({getState,isBusy,setBusy,api,onLive,notice}){
 const $=s=>document.querySelector(s);let starting=false,stamp=null,offset=0;
 function render(){
  const state=getState(),live=state?.live,t=live?.timer,active=live?.currentRound>0&&['live','break'].includes(live.status);
  if(Number.isFinite(live?.serverNow)&&live.serverNow!==stamp){stamp=live.serverNow;offset=stamp-Date.now();}
  const ms=t?.status==='running'&&t.deadlineAt!=null?Math.max(0,t.deadlineAt-Date.now()-offset):t?.remainingMs??300000;
  const seconds=Math.ceil(ms/1000);
  $('#host-timer-value').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  $('#host-timer-value').hidden=!active;
  $('#start-round-timer').hidden=!active;
  $('#start-round-timer').disabled=starting||isBusy()||!!state?.pending||!t||live?.status!=='live'||t.complete||ms<=0||t.status==='running';
  $('#start-round-timer').textContent=starting?'Starting timer…':t?.complete||ms<=0?'Round complete':live?.status==='break'?'On break':t?.status==='running'?'Timer running':t?.status==='paused'?'Resume timer':'Start 5-minute timer';
  $('#host-timer-status').textContent=!active?'Release a round, then start its five-minute timer here.':!t?'Connecting to the shared timer…':t.complete||ms<=0?'Round complete. Feedback is available.':live.status==='break'?'Timer paused. Resume the round to continue.':t.status==='running'?`Round ${live.currentRound} is running. The live display follows automatically.`:t.status==='paused'?'Resume the remaining time when everyone is ready.':`Round ${live.currentRound} is ready. Start the timer when everyone is seated.`;
 }
 $('#start-round-timer').onclick=async()=>{
  render();if($('#start-round-timer').hidden||$('#start-round-timer').disabled)return;
  const state=getState(),live=state.live;
  const body={expectedVersion:state.version,expectedPublicVersion:live.version,runId:live.runId,round:live.currentRound,timerVersion:live.timer.version};
  starting=true;setBusy(true);render();
  try{onLive(await api('timer/start',body));notice('Timer started. The ChiPMA live display updates automatically.');}
  catch(error){notice(error.message,true);try{onLive(await api('live'));}catch{}}
  finally{starting=false;setBusy(false);render();}
 };
 setInterval(render,1000);
 return {render};
}
