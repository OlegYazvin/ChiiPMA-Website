import {ROUNDS,extraStudentPairs,measure,participants,pairAllowed,usesStudentGroups,generateFast,careerPair,validateSchedule,circleSchedule,shuffle,rng} from './matching.mjs';
import {alternatingBaseline} from './alternating-solver.mjs';
// Full round-indexed MILP for changed rosters that do not fit the exact
// bipartite fast path. Higher priorities are fixed before optimizing lower ones.
export function generateGeneral(roster,seed,highs,progress=()=>{},seconds=60,initialSchedule=null){
 const people=shuffle(participants(roster),rng(seed)),edges=[];
 const grouped=usesStudentGroups(people),anchor=grouped?null:people.find(a=>a.studentPairAnchor&&a.alternateStudentPartners),extra=extraStudentPairs(people,anchor),pivot=grouped?people[0]:anchor;
 if(anchor){const students=people.filter(a=>a.isMpdStudent).length,others=people.length-students;if(students<7||others<6)throw Error('Alternating the anchor requires six other MPD² students and six non-student partners.');if(students>others+2*extra)throw Error('Even rounds require at least as many non-students as MPD² students. Update attendance before generating.');}
 for(let i=0;i<people.length;i++)for(let j=i+1;j<people.length;j++)edges.push([i,j]);
 const vars=[],incident=people.map(()=>[]),pairVars=edges.map(()=>[]),leaderVars=people.map(()=>[]);
 const objectives=Array.from({length:6},()=>[]),names=[];
 for(let r=0;r<ROUNDS;r++)edges.forEach(([i,j],e)=>{
  const a=people[i],b=people[j],name=`x${r}_${e}`;
  if(!pairAllowed(a,b))return;
  if(anchor){if(!extra&&a.isMpdStudent&&b.isMpdStudent&&a!==anchor&&b!==anchor)return;if((a===anchor||b===anchor)&&(a===anchor?b:a).isMpdStudent!==(r%2===0))return;}
  names.push(name);vars.push({name,r,i,j});incident[i].push([r,name]);incident[j].push([r,name]);pairVars[e].push(name);
  if(a.isMpdStudent&&b.isMpdStudent){objectives[0].push([name,1]);if(!a.studentPairAnchor&&!b.studentPairAnchor)objectives[1].push([name,1]);}
  if(a.currentPeopleLeader&&b.currentPeopleLeader)objectives[2].push([name,-1]);
  if(a.level==='People leader'&&b.level==='People leader'){leaderVars[i].push(name);leaderVars[j].push(name);}
  if(a.unemployedMatchingPriority&&b.employmentStatus==='Unemployed'||b.unemployedMatchingPriority&&a.employmentStatus==='Unemployed')objectives[4].push([name,-1]);
  if(careerPair(a,b))objectives[5].push([name,-1]);
 });
 const sum=ns=>ns.join(' + '),rows=[];
 for(let r=0;r<ROUNDS;r++)for(let i=0;i<people.length;i++)rows.push(`d${r}_${i}: ${sum(incident[i].filter(x=>x[0]===r).map(x=>x[1]))} = 1`);
 pairVars.forEach((ns,e)=>{if(ns.length)rows.push(`u${e}: ${sum(ns)} <= 1`);});
 if(anchor){const ai=people.indexOf(anchor);for(let r=0;r<ROUNDS-2;r++){
  const terms=vars.filter(v=>(v.r===r||v.r===r+2)&&(v.i===ai||v.j===ai)).map(v=>`${v.r===r?'+':'-'} ${1+(v.i===ai?v.j:v.i)} ${v.name}`);
  rows.push(`anchor_order_${r}: ${terms.join(' ')} <= -1`);
 }}
 if(anchor){
  for(let r=0;r<ROUNDS;r++)rows.push(`extra_${r}: ${sum(vars.filter(v=>v.r===r&&people[v.i].isMpdStudent&&people[v.j].isMpdStudent&&people[v.i]!==anchor&&people[v.j]!==anchor).map(v=>v.name))||`0 ${vars[0].name}`} = ${extra}`);
 }
 if(grouped){const pi=people.indexOf(pivot);for(let r=0;r<ROUNDS-1;r++){
  const terms=vars.filter(v=>(v.r===r||v.r===r+1)&&(v.i===pi||v.j===pi)).map(v=>`${v.r===r?'+':'-'} ${1+(v.i===pi?v.j:v.i)} ${v.name}`);
  rows.push(`round_order_${r}: ${terms.join(' ')} <= -1`);
 }}
 if(anchor||grouped){const bound=measure(roster,[]).currentLeaderUpperBound;if(objectives[2].length)rows.push(`leader_bound: ${sum(objectives[2].map(([n])=>n))} <= ${bound}`);}
 const y=[];people.forEach((a,i)=>{if(a.level==='People leader'&&leaderVars[i].length){const n=`y${i}`;y.push(n);names.push(n);rows.push(`l${i}: ${sum(leaderVars[i])} - ${n} >= 0`);objectives[3].push([n,-1]);}});
 const lp=`Minimize\n obj: 0 ${vars[0].name}\nSubject To\n ${rows.join('\n ')}\nBinary\n ${names.join(' ')}\nEnd`;
 const model=highs.createModel({format:'lp',data:lp});let best=initialSchedule||(anchor?alternatingBaseline(roster,seed):grouped?generateFast(roster,seed,{baselineOnly:true}):circleSchedule(roster,seed)),optimal=true;const start=Date.now();
 try{validateSchedule(roster,best);}catch{best=null;}
 if(anchor&&best){
  const order=new Map(people.map((a,i)=>[a.id,i])),partner=r=>order.get(r.pairs.find(p=>p.includes(anchor.id)).find(id=>id!==anchor.id));
  const odd=best.rounds.filter((_,i)=>i%2===0).sort((a,b)=>partner(a)-partner(b)),even=best.rounds.filter((_,i)=>i%2===1).sort((a,b)=>partner(a)-partner(b));
  best={...best,rounds:Array.from({length:ROUNDS},(_,i)=>({...((i%2===0?odd:even)[Math.floor(i/2)]),number:i+1}))};
 }
 if(grouped&&best){const order=new Map(people.map((a,i)=>[a.id,i])),partner=r=>order.get(r.pairs.find(p=>p.includes(pivot.id)).find(id=>id!==pivot.id));best={...best,rounds:[...best.rounds].sort((a,b)=>partner(a)-partner(b)).map((r,i)=>({...r,number:i+1}))};}
 const labels=['Minimizing student pairs','Concentrating student pairs on the anchor','Maximizing current leader meetings','Covering every people leader','Matching unemployed attendees with the priority attendee','Optimizing career-advancing meetings'];
 try{
  const cols=new Map(names.map(n=>[n,model.getColByName(n)]));
  const baseline=new Float64Array(names.length),pairsByRound=best?.rounds.map(r=>new Set(r.pairs.map(p=>[...p].sort().join('\0'))));
  for(const v of vars)if(pairsByRound?.[v.r].has([people[v.i].id,people[v.j].id].sort().join('\0')))baseline[cols.get(v.name)]=1;
  people.forEach((a,i)=>{if(cols.has(`y${i}`)&&leaderVars[i].some(n=>baseline[cols.get(n)]===1))baseline[cols.get(`y${i}`)]=1;});
  if(best)model.setSolution({colValue:baseline});
  for(const stage of grouped?[2,0,3,4,5]:[0,1,2,3,4,5]){
   const terms=objectives[stage];if(!terms.length||anchor&&stage<2)continue;
   const remaining=seconds-(Date.now()-start)/1000;if(remaining<1){optimal=false;break;}
   progress(grouped&&stage===0?'Minimizing student conversations while keeping the maximum current-leader meetings':labels[stage]);
   for(const col of cols.values())model.changeColCost(col,0);
   for(const [n,c] of terms)model.changeColCost(cols.get(n),c);
   model.options.set({output_flag:false,time_limit:Math.min(20,remaining),random_seed:Number(seed)%2147483647,mip_rel_gap:0});
   model.run();const status=model.getModelStatus();
   const solution=model.getSolution();
   const candidate={id:`schedule-${Date.now()}-${seed}`,seed,method:'HiGHS mixed-integer optimization',optimizationStatus:'feasible',rounds:Array.from({length:ROUNDS},(_,r)=>({number:r+1,pairs:[]}))};
   for(const v of vars)if(solution.colValue[cols.get(v.name)]>0.5)candidate.rounds[v.r].pairs.push([people[v.i].id,people[v.j].id]);
   try{validateSchedule(roster,candidate);best=candidate;}catch{optimal=false;break;}
   if(status!==highs.constants.modelStatus.optimal){optimal=false;break;}
   const value=Math.round(terms.reduce((acc,[n,c])=>acc+c*solution.colValue[cols.get(n)],0));
   model.addRow(value,value,{indices:terms.map(([n])=>cols.get(n)),values:terms.map(([,c])=>c)});
  }
 }finally{model.dispose();}
 if(!best)throw Error('No valid schedule was found within the time limit. Check the cohort counts or try again.');
 best.optimizationStatus=optimal?'optimal':'feasible; optimization time limit';best.metrics=validateSchedule(roster,best);return best;
}
