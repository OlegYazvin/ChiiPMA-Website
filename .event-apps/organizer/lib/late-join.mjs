import {normalizeRoster,pairAllowed,pairKey,scheduledParticipants,validateSchedule} from './matching.mjs';
import {STATION_COUNT} from './stations.mjs';

const conflict=message=>{throw Object.assign(Error(message),{status:409});};

// Change only unreleased conversations. Released rounds and live state remain
// untouched so existing timers, personal links, contacts, and feedback survive.
export function queueLateJoin(state,live,ids){
 if(!state?.locked||state.pending||live?.isTest||!['live','break'].includes(live?.status)||!Number.isInteger(live.currentRound)||live.currentRound<1||live.currentRound>=12)conflict('Late arrivals require a started real event with an unreleased round and no pending release.');
 if(state.live?.version!==live.version||state.live?.currentRound!==live.currentRound||state.live?.status!==live.status||state.live?.isTest===true||JSON.stringify(state.live?.rounds)!==JSON.stringify(live.rounds))conflict('The live event changed. Refresh before adding late arrivals.');
 if(state.schedule?.participationStarts!==undefined||state.lateJoin)conflict('Late arrivals have already been queued for this schedule.');
 if(!Array.isArray(ids)||ids.length!==2||new Set(ids).size!==2||ids.some(id=>typeof id!=='string'))throw Error('Choose exactly two distinct existing attendees.');
 const arrivals=ids.map(id=>state.roster.find(a=>a.id===id));
 if(arrivals.some(a=>!a||a.included||a.qrPending))throw Error('Choose two named attendees who are not participating yet.');
 validateSchedule(state.roster,state.schedule);
 const names=new Map(state.roster.map(a=>[a.id,a.name])),prefix=state.schedule.rounds.slice(0,live.currentRound).map(r=>({number:r.number,matches:r.pairs.map((pair,i)=>({pairNumber:i+1,station:r.stations?.[i]??i+1,names:pair.map(id=>names.get(id))}))}));
 if(JSON.stringify(prefix)!==JSON.stringify(live.rounds.map(r=>({number:r.number,matches:r.matches}))))conflict('The saved schedule no longer matches the released rounds.');
 const fromRound=live.currentRound+1,participationStarts=Object.fromEntries(ids.map(id=>[id,fromRound])),roster=state.roster.map(a=>ids.includes(a.id)?{...a,included:true}:a);
 normalizeRoster(roster);
 const people=scheduledParticipants(roster,{participationStarts}),oldIds=new Set(state.schedule.rounds[0].pairs.flat());
 if(people.length!==oldIds.size+2||arrivals.some(a=>!people.some(p=>p.id===a.id))||people.some(a=>!ids.includes(a.id)&&!oldIds.has(a.id)))throw Error('These additions would change the existing participant pool.');
 const byId=new Map(roster.map(a=>[a.id,a])),used=new Set(state.schedule.rounds.flatMap(r=>r.pairs.map(p=>pairKey(...p)))),options=new Map();
 for(const r of state.schedule.rounds.slice(live.currentRound)){
  const stations=r.stations??r.pairs.map((_,i)=>i+1),newStation=Array.from({length:STATION_COUNT},(_,i)=>i+1).find(station=>!stations.includes(station));
  if(!newStation)throw Error('An additional physical station is required for late arrivals.');
  const choices=[];
  r.pairs.forEach((pair,index)=>{
   for(const [aId,bId] of [pair,[pair[1],pair[0]]]){
    const a=byId.get(aId),b=byId.get(bId),left=arrivals[0],right=arrivals[1];
    if(!pairAllowed(left,a)||!pairAllowed(right,b))continue;
    const keys=[pairKey(left.id,aId),pairKey(right.id,bId)];if(keys.some(key=>used.has(key)))continue;
    const newPairs=[[left.id,aId],[right.id,bId]],keepSecond=!!b.isMpdStudent&&!a.isMpdStudent;
    const leaderDelta=Number(left.currentPeopleLeader&&a.currentPeopleLeader)+Number(right.currentPeopleLeader&&b.currentPeopleLeader)-Number(a.currentPeopleLeader&&b.currentPeopleLeader);
    const studentDelta=Number(left.isMpdStudent&&a.isMpdStudent)+Number(right.isMpdStudent&&b.isMpdStudent)-Number(a.isMpdStudent&&b.isMpdStudent);
    choices.push({index,keys,replacement:newPairs[keepSecond?1:0],added:newPairs[keepSecond?0:1],stations,newStation,score:leaderDelta*10000-studentDelta*100+Number(a.isMpdStudent||b.isMpdStudent)});
   }
  });
  if(!choices.length)throw Error(`No permitted late-arrival insertion is available for round ${r.number}.`);
  options.set(r.number,choices.sort((a,b)=>b.score-a.score||a.index-b.index));
 }
 const chosen=new Map();let nodes=0;
 function search(){
  if(chosen.size===options.size)return true;
  if(++nodes>200000)throw Error('Late-arrival matching exceeded its search limit; the existing event is unchanged.');
  let nextRound,available;
  for(const [number,choices] of options)if(!chosen.has(number)){
   const eligible=choices.filter(choice=>choice.keys.every(key=>!used.has(key)));
   if(!eligible.length)return false;
   if(!available||eligible.length<available.length){nextRound=number;available=eligible;}
  }
  for(const choice of available){
   chosen.set(nextRound,choice);choice.keys.forEach(key=>used.add(key));
   if(search())return true;
   chosen.delete(nextRound);choice.keys.forEach(key=>used.delete(key));
  }
  return false;
 }
 if(!search())throw Error('Unable to add both attendees without repeated or prohibited partners. The existing event is unchanged.');
 const rounds=state.schedule.rounds.map(r=>{
  const choice=chosen.get(r.number);if(!choice)return r;
  const pairs=r.pairs.map((pair,index)=>index===choice.index?choice.replacement:pair);
  return {...r,pairs:[...pairs,choice.added],stations:[...choice.stations,choice.newStation]};
 });
 const schedule={...state.schedule,rounds,participationStarts,method:'Existing schedule with late arrivals',optimizationStatus:'feasible; late arrivals',stationPlan:{method:'Existing stations preserved; one additional station for late arrivals',anchors:[]}};
 schedule.metrics=validateSchedule(roster,schedule);
 return {...state,roster,schedule,lateJoin:{attendeeIds:[...ids],fromRound,publicVersion:live.version,queuedAtVersion:state.version}};
}
