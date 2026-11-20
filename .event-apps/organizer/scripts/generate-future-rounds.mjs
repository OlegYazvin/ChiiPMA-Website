// Offline-only scheduling tool. Reads a private backup and produces a proposal; never writes live state.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {normalizeRoster,pairAllowed,pairKey} from '../lib/matching.mjs';
import {minimumAssignment,STATION_COUNT} from '../lib/stations.mjs';
import loadHighs from '../public/solver/highs.mjs';

const clone=x=>structuredClone(x);
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const sum=names=>names.join(' + ');

export function validateProposal(state,excludedIds,rounds){
 const cutoff=state.live.currentRound,old=state.schedule.rounds,starts=state.schedule.participationStarts??{},ends={...(state.schedule.participationEnds??{}),...Object.fromEntries(excludedIds.map(id=>[id,cutoff+1]))},byId=new Map(normalizeRoster(state.roster).map(a=>[a.id,a]));
 ensure(rounds.length===12,'Proposal must contain twelve rounds.');
 ensure(JSON.stringify(rounds.slice(0,cutoff))===JSON.stringify(old.slice(0,cutoff)),'Released round prefix changed.');
 const pool=new Set(old.flatMap(r=>r.pairs.flat())),seenPairs=new Set();
 let currentLeaderPairs=0,studentPairs=0,futureLeaderPairs=0,futureStudentPairs=0;
 for(let ri=0;ri<rounds.length;ri++){
  const r=rounds[ri],number=ri+1;
  ensure(r.number===number,'Unexpected round number.');
  const active=new Set([...pool].filter(id=>(starts[id]??1)<=number&&(ends[id]??13)>number));
  ensure(r.pairs.length*2===active.size,'Incorrect active participant count.');
  ensure(Array.isArray(r.stations)&&r.stations.length===r.pairs.length&&new Set(r.stations).size===r.stations.length&&r.stations.every(s=>Number.isInteger(s)&&s>=1&&s<=STATION_COUNT),'Invalid station assignments.');
  const seen=new Set();
  for(const p of r.pairs){
   ensure(Array.isArray(p)&&p.length===2,'Invalid pair.');
   for(const id of p){ensure(active.has(id)&&!seen.has(id),'Unexpected or duplicated participant.');seen.add(id);}
   const [a,b]=p.map(id=>byId.get(id));ensure(a&&b&&pairAllowed(a,b),'Prohibited pair.');
   const k=pairKey(...p);ensure(!seenPairs.has(k),'Repeated conversation.');seenPairs.add(k);
   const leader=Number(a.currentPeopleLeader&&b.currentPeopleLeader),student=Number(a.isMpdStudent&&b.isMpdStudent);
   currentLeaderPairs+=leader;studentPairs+=student;if(ri>=cutoff){futureLeaderPairs+=leader;futureStudentPairs+=student;}
  }
  ensure(seen.size===active.size,'Missing active participant.');
 }
 return {rounds:12,preservedRounds:cutoff,regeneratedRounds:12-cutoff,futureParticipants:rounds.at(-1).pairs.length*2,withdrawals:excludedIds.length,currentLeaderPairs,studentPairs,futureLeaderPairs,futureStudentPairs,uniqueConversations:seenPairs.size};
}

function addStations(prefix,future){
 let previous=new Map();
 const rounds=clone(prefix);
 if(prefix.length){const r=prefix.at(-1);r.pairs.forEach((p,i)=>p.forEach(id=>previous.set(id,r.stations?.[i]??i+1)));}
 for(const r of future){
  const m=r.pairs.length;
  const costs=Array.from({length:STATION_COUNT},(_,i)=>Array.from({length:STATION_COUNT},(_,j)=>i<m?-r.pairs[i].reduce((v,id)=>v+(previous.get(id)===j+1?1000:0),0):0));
  const assignment=minimumAssignment(costs),ordered=r.pairs.map((pair,i)=>({pair,station:assignment[i]+1})).sort((a,b)=>a.station-b.station);
  const next={...r,pairs:ordered.map(v=>v.pair),stations:ordered.map(v=>v.station)};rounds.push(next);
  previous=new Map();next.pairs.forEach((p,i)=>p.forEach(id=>previous.set(id,next.stations[i])));
 }
 return rounds;
}

export async function generate(snapshot,excludedIds,options={}){
 const state=snapshot.organizer??snapshot,cutoff=state.live?.currentRound,old=state.schedule?.rounds;
 ensure(Number.isInteger(cutoff)&&cutoff>=1&&cutoff<12&&old?.length===12,'Need a started event with remaining rounds.');
 ensure(Array.isArray(excludedIds)&&excludedIds.length===2&&new Set(excludedIds).size===2,'Choose two distinct attendees to withdraw.');
 const roster=normalizeRoster(state.roster),byId=new Map(roster.map(a=>[a.id,a])),pool=[...new Set(old.flatMap(r=>r.pairs.flat()))],excluded=new Set(excludedIds);
 const starts=state.schedule.participationStarts??{},ends={...(state.schedule.participationEnds??{}),...Object.fromEntries(excludedIds.map(id=>[id,cutoff+1]))};
 ensure(excludedIds.every(id=>pool.includes(id)&&old[cutoff].pairs.flat().includes(id)),'Withdrawal participant is not active in the next round.');
 const prefix=clone(old.slice(0,cutoff)),used=new Set(prefix.flatMap(r=>r.pairs.map(p=>pairKey(...p))));
 const futureNumbers=Array.from({length:12-cutoff},(_,i)=>cutoff+i+1),vars=[],incident=new Map(),edgeVars=new Map();
 const edges=[];for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){
  const a=byId.get(pool[i]),b=byId.get(pool[j]),key=pairKey(a.id,b.id);if(!pairAllowed(a,b)||used.has(key))continue;edges.push({a,b,key});
 }
 const rows=[];
 for(const number of futureNumbers){
  const active=pool.filter(id=>(starts[id]??1)<=number&&(ends[id]??13)>number);
  ensure(active.length%2===0&&active.length/2<=STATION_COUNT,'Remaining roster has invalid parity or capacity.');
  const activeSet=new Set(active);
  edges.forEach(({a,b,key},ei)=>{if(!activeSet.has(a.id)||!activeSet.has(b.id))return;
   const name=`x${number}_${ei}`,v={name,number,a:a.id,b:b.id,leader:Number(a.currentPeopleLeader&&b.currentPeopleLeader),student:Number(a.isMpdStudent&&b.isMpdStudent)};vars.push(v);
   for(const id of [a.id,b.id]){const k=`${number}:${id}`;if(!incident.has(k))incident.set(k,[]);incident.get(k).push(name);}
   if(!edgeVars.has(key))edgeVars.set(key,[]);edgeVars.get(key).push(name);
  });
  active.forEach((id,i)=>{const ns=incident.get(`${number}:${id}`)??[];ensure(ns.length,'A participant has no remaining permitted partner.');rows.push(`p${number}_${i}: ${sum(ns)} = 1`);});
 }
 let ei=0;for(const ns of edgeVars.values())rows.push(`u${ei++}: ${sum(ns)} <= 1`);
 ensure(vars.length,'No remaining variables.');
 const lp=`Minimize\n obj: 0 ${vars[0].name}\nSubject To\n ${rows.join('\n ')}\nBinary\n ${vars.map(v=>v.name).join(' ')}\nEnd`;
 const highs=await loadHighs({print:()=>{},printErr:()=>{}}),model=highs.createModel({format:'lp',data:lp}),cols=new Map(vars.map(v=>[v.name,model.getColByName(v.name)])),start=Date.now(),statuses=[];let best=null;
 function candidate(){
  const sol=model.getSolution(),future=futureNumbers.map(number=>({...clone(old[number-1]),pairs:[]}));
  for(const v of vars)if(sol.colValue[cols.get(v.name)]>0.5)future[v.number-cutoff-1].pairs.push([v.a,v.b]);
  const rounds=addStations(prefix,future),metrics=validateProposal(state,excludedIds,rounds);return {rounds,metrics};
 }
 try{
  model.options.set({output_flag:false,time_limit:Math.min(15,options.seconds??90),random_seed:options.seed??53721,mip_rel_gap:0});model.run();
  statuses.push({stage:'feasibility',status:model.getModelStatus()});
  try{best=candidate();}catch{throw Error('No feasible remaining-round schedule was found within the initial time limit.');}
  if(options.onFeasible)await options.onFeasible(best);
  for(const stage of options.optimize===false?[]:['leader','student']){
   const remaining=(options.seconds??90)-(Date.now()-start)/1000;if(remaining<1)break;
   const terms=vars.filter(v=>v[stage]).map(v=>[cols.get(v.name),stage==='leader'?-1:1]);if(!terms.length)continue;
   for(const col of cols.values())model.changeColCost(col,0);for(const [col,cost] of terms)model.changeColCost(col,cost);
   model.options.set({time_limit:Math.min(30,remaining)});model.run();const status=model.getModelStatus();statuses.push({stage,status});
   try{best=candidate();}catch{break;}
   if(options.onFeasible)await options.onFeasible(best);
   if(status!==highs.constants.modelStatus.optimal)break;
   const sol=model.getSolution(),value=Math.round(terms.reduce((v,[col,cost])=>v+cost*sol.colValue[col],0));model.addRow(value,value,{indices:terms.map(t=>t[0]),values:terms.map(t=>t[1])});
  }
 }finally{model.dispose();}
 return {sourceVersion:state.version,sourceLiveVersion:state.live.version,sourceCurrentRound:cutoff,excludedIds:[...excludedIds],participationEnds:ends,...best,solverStages:statuses,elapsedSeconds:(Date.now()-start)/1000};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const args=process.argv.slice(2),at=k=>args[args.indexOf(k)+1],input=at('--input'),output=at('--output'),ids=(at('--exclude')??'').split(',').filter(Boolean);
 ensure(args.includes('--input')&&args.includes('--output')&&args.includes('--exclude'),'Use --input private-backup.json --exclude id1,id2 --output private-proposal.json [--seconds 90] [--no-optimize].');
 const snapshot=JSON.parse(fs.readFileSync(input,'utf8'));
 const result=await generate(snapshot,ids,{seconds:args.includes('--seconds')?Number(at('--seconds')):90,optimize:!args.includes('--no-optimize'),onFeasible:best=>{fs.writeFileSync(output,JSON.stringify({sourceVersion:(snapshot.organizer??snapshot).version,...best},null,2),{mode:0o600});}});
 fs.writeFileSync(output,JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({sourceVersion:result.sourceVersion,sourceCurrentRound:result.sourceCurrentRound,...result.metrics,solverStages:result.solverStages,elapsedSeconds:result.elapsedSeconds}));
}
