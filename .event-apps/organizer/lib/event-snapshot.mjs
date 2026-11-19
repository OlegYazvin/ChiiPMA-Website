import {EVENT_ID} from './public-state.mjs';
import {effectiveQuestionForRound} from './question-bank.mjs';
export function publicSnapshot(state,status,currentRound,isTest=false){
 const names=new Map(state.roster.map(a=>[a.id,a.name]));
 return {eventId:EVENT_ID,status,isTest,currentRound,totalRounds:12,rounds:state.schedule.rounds.slice(0,currentRound).map(r=>{
  const released=state.live?.rounds?.find(old=>old.number===r.number);
  const leadQuestion=released?(released.leadQuestion??null):effectiveQuestionForRound(state,r.number,isTest);
  return {number:r.number,...leadQuestion?{leadQuestion}:{},matches:r.pairs.map((pair,i)=>({pairNumber:i+1,station:r.stations?.[i]??i+1,names:pair.map(id=>names.get(id))}))};
 })};
}
