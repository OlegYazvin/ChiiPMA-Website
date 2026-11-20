import {normalizeRoster,roundParticipants,validateSchedule} from './matching.mjs';

const conflict=message=>{throw Object.assign(Error(message),{status:409});};

// The offline solver proposes full rounds. This transaction accepts only a
// valid replacement of the unreleased suffix; previous conversations stay
// available on the existing personal links for contacts and final feedback.
export function queueWithdrawals(state,live,ids,rounds){
 if(!state?.locked||state.pending||live?.isTest||!['live','break'].includes(live?.status)||!Number.isInteger(live.currentRound)||live.currentRound<1||live.currentRound>=12)conflict('Departures require a started real event with an unreleased round and no pending release.');
 if(state.live?.version!==live.version||state.live?.currentRound!==live.currentRound||state.live?.status!==live.status||state.live?.isTest===true||JSON.stringify(state.live?.rounds)!==JSON.stringify(live.rounds))conflict('The live event changed. Refresh before saving departures.');
 if(state.schedule?.participationEnds!==undefined||state.withdrawals)conflict('Departures have already been queued for this schedule.');
 if(!Array.isArray(ids)||ids.length!==2||new Set(ids).size!==2||ids.some(id=>typeof id!=='string'))throw Error('Choose exactly two distinct participating attendees.');
 validateSchedule(state.roster,state.schedule);
 const activeIds=new Set(roundParticipants(state.roster,state.schedule,live.currentRound).map(a=>a.id));
 if(ids.some(id=>!activeIds.has(id)))throw Error('Choose two attendees participating in the current round.');
 if(!Array.isArray(rounds)||rounds.length!==12)throw Error('Provide all twelve proposed rounds.');
 if(JSON.stringify(rounds.slice(0,live.currentRound))!==JSON.stringify(state.schedule.rounds.slice(0,live.currentRound)))conflict('Released schedule rounds cannot be changed.');
 const names=new Map(state.roster.map(a=>[a.id,a.name])),prefix=state.schedule.rounds.slice(0,live.currentRound).map(r=>({number:r.number,matches:r.pairs.map((pair,i)=>({pairNumber:i+1,station:r.stations?.[i]??i+1,names:pair.map(id=>names.get(id))}))}));
 if(JSON.stringify(prefix)!==JSON.stringify(live.rounds.map(r=>({number:r.number,matches:r.matches}))))conflict('The saved schedule no longer matches the released rounds.');
 const fromRound=live.currentRound+1,roster=state.roster.map(a=>ids.includes(a.id)?{...a,included:false}:a),participationEnds=Object.fromEntries(ids.map(id=>[id,fromRound]));
 normalizeRoster(roster);
 const schedule={...state.schedule,rounds:rounds.map((r,i)=>i<live.currentRound?state.schedule.rounds[i]:structuredClone(r)),participationEnds,method:'Remaining rounds regenerated after departures',optimizationStatus:'feasible; remaining rounds regenerated',stationPlan:{method:'Released stations preserved; remaining stations regenerated',anchors:[]}};
 schedule.metrics=validateSchedule(roster,schedule);
 return {...state,roster,schedule,withdrawals:{attendeeIds:[...ids],fromRound,publicVersion:live.version,queuedAtVersion:state.version}};
}
