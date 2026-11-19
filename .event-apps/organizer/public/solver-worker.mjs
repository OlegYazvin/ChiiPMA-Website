import {normalizeRoster,generateFast,validateSchedule} from './matching.mjs?v=11';
import {assignStations} from './stations.mjs?v=11';
import {generateGeneral} from './general-solver.mjs?v=11';
import {generateAlternating} from './alternating-solver.mjs?v=11';
self.onmessage=async ({data})=>{
 try{
  const roster=normalizeRoster(data.roster);self.postMessage({progress:'Finding unique partners…'});
  let schedule=generateAlternating(roster,data.seed,progress=>self.postMessage({progress}))||generateFast(roster,data.seed);
  if(!schedule||schedule.optimizationStatus!=='optimal'){
   self.postMessage({progress:'Optimizing the revised roster. This can take up to 90 seconds…'});
   const {default:loadHighs}=await import('./solver/highs.mjs');
   const highs=await loadHighs({locateFile:f=>new URL('./solver/'+f,import.meta.url).href});
   schedule=generateGeneral(roster,data.seed,highs,progress=>self.postMessage({progress}),90,schedule);
  }
  self.postMessage({progress:'Assigning stations to keep as many people seated as possible…'});
  schedule=assignStations(schedule,roster);schedule.metrics=validateSchedule(roster,schedule);
  self.postMessage({schedule});
 }catch(e){self.postMessage({error:e.message});}
};
