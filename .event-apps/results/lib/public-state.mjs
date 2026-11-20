export const EVENT_ID="chipma-2026-11-19";
export const STATION_COUNT=21;
export function waitingState(){return {eventId:EVENT_ID,version:0,status:"waiting",isTest:false,currentRound:0,totalRounds:12,rounds:[],updatedAt:null};}
export function sanitizePublicState(data){
  if(!data||data.eventId!==EVENT_ID||!["waiting","live","break","finished"].includes(data.status)||!Number.isInteger(data.currentRound)||data.currentRound<0||data.currentRound>12||!Array.isArray(data.rounds)||data.rounds.length!==data.currentRound)throw Error("Invalid released state.");
  if(data.status==="waiting"&&data.currentRound!==0||data.status!=="waiting"&&data.currentRound===0||data.status==="finished"&&data.currentRound!==12)throw Error("Invalid event status.");
  if(data.isTest!==undefined&&typeof data.isTest!=="boolean"||data.status==="waiting"&&data.isTest)throw Error("Invalid test mode.");
  const allPairs=new Set();
  const rounds=data.rounds.map((r,i)=>{
    if(r.number!==i+1||!Array.isArray(r.matches)||!r.matches.length||r.matches.length>STATION_COUNT)throw Error("Invalid round.");
    const seen=new Set(),stations=new Set();
    const matches=r.matches.map((m,j)=>{
      if(!Array.isArray(m.names)||m.names.length!==2||m.names.some(n=>typeof n!=="string"||!n.trim()||n.length>180))throw Error("Invalid pair names.");
      const names=m.names.map(n=>n.trim());
      for(const n of names){if(seen.has(n))throw Error("Duplicate attendee in released round.");seen.add(n);}
      const key=[...names].sort().join("\u0000");if(allPairs.has(key))throw Error("Repeated public pair.");allPairs.add(key);
      const station=m.station===undefined?j+1:m.station;if(!Number.isInteger(station)||station<1||station>STATION_COUNT||stations.has(station))throw Error(`Stations must be unique numbers from 1 through ${STATION_COUNT}.`);stations.add(station);
      return {pairNumber:j+1,station,names};
    });
    if(r.leadQuestion!=null&&(typeof r.leadQuestion!=="string"||!r.leadQuestion.trim()||r.leadQuestion.length>1000))throw Error("Invalid lead question.");
    return {number:i+1,...r.leadQuestion!=null?{leadQuestion:r.leadQuestion.trim()}:{},matches};
  });
  return {eventId:EVENT_ID,status:data.status,isTest:data.isTest===true,currentRound:data.currentRound,totalRounds:12,rounds};
}
export function validateTransition(previous,next,{resetTest=false,resetReal=false}={}){
  if(resetReal){
    if(resetTest||previous.isTest||previous.currentRound===0)throw Error("Only a started real event can be reset.");
    if(next.status!=="waiting"||next.currentRound!==0||next.rounds.length!==0||next.isTest)throw Error("Reset must return the display to waiting.");
    return;
  }
  if(resetTest){
    if(previous.isTest!==true||previous.currentRound===0)throw Error("Only a test run can be reset.");
    if(next.status!=="waiting"||next.currentRound!==0||next.rounds.length!==0||next.isTest)throw Error("Reset must return the display to waiting.");
    return;
  }
  if(previous.status!=="waiting"&&!!previous.isTest!==!!next.isTest)throw Error("A started event cannot change test mode.");
  if(next.currentRound<previous.currentRound||next.currentRound>previous.currentRound+1)throw Error("Release one round at a time.");
  if(previous.status==="finished")throw Error("The event is finished.");
  if(JSON.stringify(next.rounds.slice(0,previous.currentRound))!==JSON.stringify(previous.rounds))throw Error("Released matches are immutable.");
  const allowed=previous.status==="waiting"?next.status==="live"&&next.currentRound===1:next.currentRound===previous.currentRound+1?previous.status==="live"&&next.status==="live":previous.status==="live"?["break","finished"].includes(next.status):previous.status==="break"&&next.status==="live";
  if(!allowed)throw Error("Invalid host action for the current round.");
}
