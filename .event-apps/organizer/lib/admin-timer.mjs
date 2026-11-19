function conflict(message){throw Object.assign(Error(message),{status:409});}

// The owner-private route authorizes the organizer. Keep the timer capability
// server-side and delegate duration, compare-and-swap, and pause handling to
// the existing authoritative timer service.
export async function startAdminTimer(state,body,{readLive,hostSession,startTimer}){
 if(state.pending)conflict('Finish the pending round release before starting the timer.');
 const live=await readLive();
 if(live.status!=='live'||body.runId!==live.runId||body.round!==live.currentRound||body.expectedPublicVersion!==live.version)conflict('The current round changed. Refresh and retry.');
 if(!live.timer||live.timer.complete||live.timer.status==='running'||body.timerVersion!==live.timer.version)conflict('The timer changed. Refresh and retry.');
 const session=await hostSession();let token;
 try{token=new URLSearchParams(new URL(session.url).hash.slice(1)).get('host');if(!token)throw Error();}catch{throw Object.assign(Error('Timer authorization is temporarily unavailable.'),{status:503});}
 await startTimer(token,{runId:live.runId,round:live.currentRound,expectedVersion:body.timerVersion});
 return readLive();
}
