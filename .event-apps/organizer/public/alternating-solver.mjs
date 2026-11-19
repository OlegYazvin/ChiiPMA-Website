import {generateFast,extraStudentPairs,participants,pairAllowed,usesStudentGroups,validateSchedule,pairKey,careerPair,ROUNDS,rng,shuffle} from './matching.mjs?v=11';

// Start with an exact, degree-constrained cross-cohort schedule, then exchange
// two non-leading-student/current-leader edges in six distinct rounds. Each
// exchange creates an anchor/student pair and a current-leader pair, preserving
// all other objective counts. Search only tie-equivalent base schedules.
export function generateAlternating(roster,seed=1,progress=()=>{},attempts=80,{allowAnyNonStudents=false,excludedExchangeIds=[]}={}){
 if(usesStudentGroups(roster))return null;
 const people=participants(roster),anchor=people.find(a=>a.studentPairAnchor&&a.alternateStudentPartners);
 if(!anchor)return null;
 if(extraStudentPairs(people,anchor))return generateExtraStudentBaseline(roster,seed,progress);
 const students=people.filter(a=>a.isMpdStudent),others=people.filter(a=>!a.isMpdStudent),leaders=others.filter(a=>a.currentPeopleLeader);
 if(students.length<7||others.length<6)throw Error('Alternating the anchor requires six other MPD² students and six non-student partners.');
 if(students.length!==others.length||!allowAnyNonStudents&&(anchor.currentPeopleLeader||leaders.length<6))return null;
 const clean=roster.map(a=>({...a,alternateStudentPartners:false})),byId=new Map(people.map(a=>[a.id,a]));
 const random=rng(seed);let best=null;
 for(let attempt=0;attempt<attempts;attempt++){
  if(attempt%10===0)progress('Creating alternating student and non-student conversations…');
  const base=generateFast(clean,(Number(seed)+attempt*9973)>>>0,{preferAnchorLeaders:true});if(!base)return null;
  if(base.rounds.some(r=>r.pairs.some(p=>p.includes(anchor.id)&&p.some(id=>excludedExchangeIds.includes(id)))))continue;
  const coverage=new Map();for(const r of base.rounds)for(const p of r.pairs)if(p.every(id=>byId.get(id).level==='People leader'))for(const id of p)coverage.set(id,(coverage.get(id)||0)+1);
  const choices=[];
  base.rounds.forEach((r,ri)=>{
   const ai=r.pairs.findIndex(p=>p.includes(anchor.id)),an=r.pairs[ai].find(id=>id!==anchor.id);
   if(excludedExchangeIds.includes(an)||!allowAnyNonStudents&&!byId.get(an).currentPeopleLeader)return;
   const options=[];
   r.pairs.forEach((p,pi)=>{
    if(pi===ai)return;const s=p.find(id=>byId.get(id).isMpdStudent),n=p.find(id=>!byId.get(id).isMpdStudent);
    if(!s||!n||excludedExchangeIds.includes(n)||!allowAnyNonStudents&&(byId.get(s).currentPeopleLeader||!byId.get(n).currentPeopleLeader))return;
    if(!pairAllowed(anchor,byId.get(s))||!pairAllowed(byId.get(an),byId.get(n)))return;
    if(!allowAnyNonStudents&&byId.get(s).level==='People leader'&&(coverage.get(s)||0)<2)return;
    options.push({ri,ai,pi,s,n,an,key:pairKey(an,n)});
   });
   if(options.length)choices.push({ri,options:shuffle(options,random)});
  });
  if(choices.length<6)continue;
  choices.sort((a,b)=>a.options.length-b.options.length);
  const usedStudents=new Set(),usedPairs=new Set(),selected=[];
  function search(index){
   if(selected.length===6)return true;
   if(choices.length-index<6-selected.length)return false;
   for(let k=index;k<choices.length;k++)for(const choice of choices[k].options){
    if(usedStudents.has(choice.s)||usedPairs.has(choice.key))continue;
    selected.push(choice);usedStudents.add(choice.s);usedPairs.add(choice.key);
    if(search(k+1))return true;
    selected.pop();usedStudents.delete(choice.s);usedPairs.delete(choice.key);
   }
   return false;
  }
  if(!search(0))continue;
  const rounds=structuredClone(base.rounds),odd=[];const selectedRounds=new Set();
  for(const c of selected){rounds[c.ri].pairs[c.ai]=[anchor.id,c.s];rounds[c.ri].pairs[c.pi]=[c.an,c.n];selectedRounds.add(c.ri);odd.push(rounds[c.ri]);}
  const even=shuffle(rounds.filter((_,i)=>!selectedRounds.has(i)),random),oddOrdered=shuffle(odd,random),ordered=[];
  for(let i=0;i<6;i++)ordered.push(oddOrdered[i],even[i]);ordered.forEach((r,i)=>r.number=i+1);
  const schedule={id:`schedule-${Date.now()}-${seed}`,seed,rounds:ordered,method:'Alternating anchor with optimized leader exchanges',optimizationStatus:'feasible'};
  schedule.metrics=validateSchedule(roster,schedule);
  if(allowAnyNonStudents)return schedule;
  const m=schedule.metrics,currentS=students.filter(a=>a.currentPeopleLeader).length,currentN=leaders.length;
  const careerBound=students.reduce((total,s)=>total+Math.min(others.filter(n=>careerPair(s,n)).length,ROUNDS-(s.id===anchor.id?6:0)-(s.currentPeopleLeader?currentN:0)),0);
  const priority=people.find(a=>a.unemployedMatchingPriority),unemployedBound=Math.min(ROUNDS,students.filter(a=>a.employmentStatus==='Unemployed'&&a!==priority).length);
  // For this bound, all extra non-student pairs must be current-leader pairs;
  // the priority attendee is an IC and can therefore only meet students.
  const proven=m.currentLeaderPairs===currentS*currentN+6&&m.leadersCovered===m.totalLeaders&&priority&&!priority.currentPeopleLeader&&m.priorityUnemployedPairs===unemployedBound&&m.careerPairs===careerBound;
  if(proven){schedule.optimizationStatus='optimal';return schedule;}
  if(!best||m.currentLeaderPairs>best.metrics.currentLeaderPairs||m.currentLeaderPairs===best.metrics.currentLeaderPairs&&m.careerPairs>best.metrics.careerPairs)best=schedule;
 }
 return best;
}
export function alternatingBaseline(roster,seed=1){return generateAlternating(roster,seed,()=>{},20,{allowAnyNonStudents:true});}

// Two temporary non-students turn the imbalanced roster into a balanced seed.
// Replacing their two cross-cohort pairs with one real student pair removes
// both temporary vertices without changing anyone else's partner or parity.
function generateExtraStudentBaseline(roster,seed,progress){
 const people=participants(roster);
 const virtual=Array.from({length:2},(_,i)=>({id:`__extra-student-pair-${i}`,name:`Temporary pairing vertex ${i}`,isMpdStudent:false,isStudent:false,level:null,jobs:[],employmentStatus:null,included:true}));
 // Leave the parity reserve out of this synthetic construction.
 const augmented=[...people.map(a=>({...a,parityReserve:false,allowAdditionalStudentPair:false})),...virtual],virtualIds=virtual.map(a=>a.id);
 for(let attempt=0;attempt<30;attempt++){
 const base=generateAlternating(augmented,(Number(seed)+attempt*7919)>>>0,progress,160,{allowAnyNonStudents:true,excludedExchangeIds:virtualIds});if(!base)return null;
 const rounds=base.rounds.map(r=>{
  const temporary=r.pairs.filter(p=>p.some(id=>virtualIds.includes(id)));
  const pairs=r.pairs.filter(p=>!p.some(id=>virtualIds.includes(id)));
  pairs.push(temporary.map(p=>p.find(id=>!virtualIds.includes(id))));return{number:r.number,pairs};
 });
 const schedule={id:`schedule-${Date.now()}-${seed}`,seed,rounds,method:'Alternating anchor with one additional student pair',optimizationStatus:'feasible'};
 try{schedule.metrics=validateSchedule(roster,schedule);return schedule;}catch{}
 }
 return null;
}
