import {qrSlotFields} from './qr-slots.mjs';
import {measureStations,STATION_COUNT} from './stations.mjs';
export const ROUNDS = 12;
export const LEVELS = ["Associate", "Senior", "Principal", "People leader"];
export const JOBS = ["Product Management", "Something in software that isn't product management", "Student", "Coaching", "Other"];
export const STUDENT_GROUPS=['first_year','second_year'];
export function usesStudentGroups(roster){return roster.some(a=>a.isMpdStudent&&a.studentPairGroup!=null);}
export function normalizeRoster(input) {
  if (!Array.isArray(input) || input.length > 100) throw Error("Supply a roster of up to 100 attendees.");
  const ids = new Set(), names = new Set(),grouped=usesStudentGroups(input);
  const rows = input.map(a => {
    if (typeof a.id !== "string" || !a.id.trim() || a.id.length > 100 || ids.has(a.id)) throw Error("Each attendee needs a unique, nonempty ID.");
    ids.add(a.id);
    if (typeof a.name !== "string" || !a.name.trim() || a.name.length > 160) throw Error("Each attendee needs a display name.");
    const nameKey=a.name.trim().toLocaleLowerCase();if(names.has(nameKey))throw Error("Use unique display names; add an initial when two people share a name.");names.add(nameKey);
    if (a.level !== null && !LEVELS.includes(a.level)) throw Error("Invalid professional level.");
    if (![null,"Employed","Unemployed"].includes(a.employmentStatus)) throw Error("Invalid employment status.");
    if (!Array.isArray(a.jobs) || a.jobs.some(j=>!JOBS.includes(j))) throw Error("Invalid job category.");
    if(a.teamId!=null&&(typeof a.teamId!=="string"||a.teamId.length>80))throw Error("Team must be a label of up to 80 characters.");
    if(a.studentPairGroup!=null&&!['',...STUDENT_GROUPS].includes(a.studentPairGroup))throw Error("Invalid student conversation group.");
    if (a.currentPeopleLeader && (a.level !== "People leader" || a.employmentStatus !== "Employed")) throw Error("Current people leaders must have an active employed leadership role.");
    if(a.allowAdditionalStudentPair&&(!a.studentPairAnchor||!a.alternateStudentPartners))throw Error("The extra student-pair option requires an alternating student anchor.");
    if(a.alternateStudentPartners&&(!a.studentPairAnchor||!a.isMpdStudent))throw Error("Alternating student partners requires an MPD² student anchor.");
    return {...qrSlotFields(a),id:a.id,name:a.name.trim(),isMpdStudent:!!a.isMpdStudent,isStudent:!!a.isStudent,teamId:(a.teamId??'').trim().toLocaleLowerCase(),studentPairGroup:grouped&&a.isMpdStudent?(a.studentPairGroup??''):null,level:a.level,jobs:[...new Set(a.jobs)],employmentStatus:a.employmentStatus,currentPeopleLeader:!!a.currentPeopleLeader,included:a.included!==false,parityReserve:!!a.parityReserve,studentOnlyPartners:!!a.studentOnlyPartners,studentPairAnchor:!grouped&&!!a.studentPairAnchor,alternateStudentPartners:!grouped&&!!a.alternateStudentPartners,allowAdditionalStudentPair:!grouped&&!!a.allowAdditionalStudentPair,unemployedMatchingPriority:!!a.unemployedMatchingPriority};
  });
  for (const key of ["parityReserve","studentPairAnchor","unemployedMatchingPriority"]) if(rows.filter(a=>a[key]).length>1) throw Error(`Only one attendee may have ${key}.`);
  return rows;
}
export function participants(roster) {
  const regular=roster.filter(a=>a.included&&!a.parityReserve);
  const reserve=roster.find(a=>a.parityReserve&&a.included);
  if (regular.length%2 && reserve) regular.push(reserve);
  if(regular.length%2) throw Error("An even roster is required. Include the parity reserve or add another attendee.");
  if(regular.length<14) throw Error("Twelve unique partners require at least 14 attendees with an even roster.");
  if(regular.length>STATION_COUNT*2)throw Error(`${STATION_COUNT} stations accommodate at most ${STATION_COUNT*2} attendees. Update attendance before generating.`);
  for(const a of regular)if(regular.filter(b=>b.id!==a.id&&pairAllowed(a,b)).length<ROUNDS)throw Error(a.studentOnlyPartners?`${a.name} needs at least twelve eligible MPD² student partners.`:`${a.name} needs at least twelve eligible partners outside their team.`);
  return regular;
}
export function sameTeam(a,b){return !!a.teamId&&a.teamId===b.teamId;}
export function studentPairAllowed(a,b){return !a.isMpdStudent||!b.isMpdStudent||(a.studentPairGroup==null&&b.studentPairGroup==null)||!!(a.studentPairGroup&&b.studentPairGroup&&a.studentPairGroup!==b.studentPairGroup);}
export function pairAllowed(a,b){return !sameTeam(a,b)&&studentPairAllowed(a,b)&&(!a.studentOnlyPartners||b.isMpdStudent)&&(!b.studentOnlyPartners||a.isMpdStudent);}
// The approved extra exception scales back to zero when the cohorts balance.
export function extraStudentPairs(people,anchor=people.find(a=>a.studentPairAnchor&&a.alternateStudentPartners)) {
  if(!anchor?.allowAdditionalStudentPair)return 0;
  const students=people.filter(a=>a.isMpdStudent).length,extra=Math.max(0,students-people.length/2);
  if(extra>1)throw Error("At most one additional student pair per round is allowed. Update attendance before generating.");
  return extra;
}
export function pairKey(a,b) {return [a,b].sort().join("\u0000");}
export function careerPair(a,b) {
  const s=a.isMpdStudent?a:b.isMpdStudent?b:null;
  const p=s===a?b:a;
  return !!s && !p.isStudent && !p.isMpdStudent && p.jobs.includes("Product Management") && p.level!=="People leader" && LEVELS.indexOf(p.level)>=0 && LEVELS.indexOf(s.level)>LEVELS.indexOf(p.level);
}
export function measure(roster, rounds) {
  const people=participants(roster), byId=new Map(people.map(a=>[a.id,a]));
  const grouped=usesStudentGroups(people),alternating=grouped?null:people.find(a=>a.studentPairAnchor&&a.alternateStudentPartners);
  const covered=new Set();let studentPairs=0,nonStudentPairs=0,anchorPairs=0,currentLeaderPairs=0,priorityUnemployedPairs=0,careerPairs=0;
  for(const r of rounds) for(const [ai,bi] of r.pairs){
    const a=byId.get(ai),b=byId.get(bi);if(!a||!b)continue;
    if(a.isMpdStudent&&b.isMpdStudent){studentPairs++;if(a.studentPairAnchor||b.studentPairAnchor)anchorPairs++;}
    if(!a.isMpdStudent&&!b.isMpdStudent)nonStudentPairs++;
    if(a.currentPeopleLeader&&b.currentPeopleLeader)currentLeaderPairs++;
    if(a.level==="People leader"&&b.level==="People leader"){covered.add(a.id);covered.add(b.id);}
    if((a.unemployedMatchingPriority&&b.employmentStatus==="Unemployed")||(b.unemployedMatchingPriority&&a.employmentStatus==="Unemployed"))priorityUnemployedPairs++;
    if(careerPair(a,b))careerPairs++;
  }
  const s=people.filter(a=>a.isMpdStudent).length,n=people.length-s;
  const currentS=people.filter(a=>a.isMpdStudent&&a.currentPeopleLeader).length,currentN=people.filter(a=>!a.isMpdStudent&&a.currentPeopleLeader).length;
  const current=people.filter(a=>a.currentPeopleLeader).length;
  const extra=extraStudentPairs(people,alternating);
  const minimumStudentPairs=alternating?ROUNDS/2+ROUNDS*extra:ROUNDS*Math.max(0,(s-n)/2);
  const leaders=people.filter(a=>a.currentPeopleLeader),permittedLeaderPairs=leaders.reduce((total,a,i)=>total+leaders.slice(i+1).filter(b=>pairAllowed(a,b)).length,0);
  const currentLeaderUpperBound=grouped?Math.min(permittedLeaderPairs,ROUNDS*Math.floor(current/2)):alternating&&s>=n&&!alternating.currentPeopleLeader?Math.min(current*(current-1)/2,ROUNDS*Math.floor(current/2),currentS*currentN+Math.min(ROUNDS/2,currentN*(currentN-1)/2)+Math.min(ROUNDS*extra,currentS*(currentS-1)/2)):studentPairs===minimumStudentPairs&&s>=n&&!people.some(a=>a.studentPairAnchor&&a.currentPeopleLeader) ? currentS*currentN : Math.min(current*(current-1)/2,ROUNDS*Math.floor(current/2));
  return {participants:people.length,pairsPerRound:people.length/2,studentPairs,nonStudentPairs,minimumStudentPairs,anchorPairs,studentGroupRule:grouped,alternatingAnchorId:alternating?.id??null,additionalStudentPairsPerRound:extra,currentLeaderPairs,currentLeaderUpperBound,leadersCovered:covered.size,totalLeaders:people.filter(a=>a.level==="People leader").length,priorityUnemployedPairs,careerPairs,uncoveredLeaderIds:people.filter(a=>a.level==="People leader"&&!covered.has(a.id)).map(a=>a.id),...measureStations(rounds)};
}
export function validateSchedule(roster,schedule) {
  const people=participants(roster),ids=new Set(people.map(a=>a.id)),byId=new Map(people.map(a=>[a.id,a])),used=new Set();
  if(!schedule || !Array.isArray(schedule.rounds)||schedule.rounds.length!==ROUNDS) throw Error("A schedule must contain exactly twelve rounds.");
  schedule.rounds.forEach((r,i)=>{
    if(r.number!==i+1 || !Array.isArray(r.pairs)||r.pairs.length!==people.length/2) throw Error(`Round ${i+1} is incomplete.`);
    const seen=new Set();
    for(const pair of r.pairs){
      if(!Array.isArray(pair)||pair.length!==2)throw Error("Each conversation must have two people.");
      for(const id of pair){if(!ids.has(id)||seen.has(id))throw Error(`Round ${i+1} contains an unknown or repeated attendee.`);seen.add(id);}
      if(sameTeam(...pair.map(id=>byId.get(id))))throw Error("Members of the same team cannot be matched for a conversation.");
      if(!studentPairAllowed(...pair.map(id=>byId.get(id))))throw Error("Student conversations must pair Group 1 with Group 2; other student–student pairs are prohibited.");
      if(!pairAllowed(...pair.map(id=>byId.get(id))))throw Error("An attendee with MPD²-only partners was matched with a non-MPD² attendee.");
      const key=pairKey(...pair);if(used.has(key))throw Error("A pair is repeated across rounds.");used.add(key);
    }
    if(seen.size!==ids.size)throw Error(`Round ${i+1} omits an attendee.`);
  });
  const alternating=usesStudentGroups(people)?null:people.find(a=>a.studentPairAnchor&&a.alternateStudentPartners);
  if(alternating){
    const byId=new Map(people.map(a=>[a.id,a])),extra=extraStudentPairs(people,alternating);
    for(const r of schedule.rounds){
      const pair=r.pairs.find(p=>p.includes(alternating.id)),partner=byId.get(pair.find(id=>id!==alternating.id));
      if(partner.isMpdStudent!==(r.number%2===1))throw Error("The student anchor must meet MPD² students in odd rounds and non-students in even rounds.");
      const additional=r.pairs.filter(p=>p.every(id=>byId.get(id).isMpdStudent)&&!p.includes(alternating.id)).length;
      if(additional!==extra)throw Error(extra?"Each round must have exactly one additional student–student pair.":"Only the alternating anchor may have a student–student match.");
    }
  }
  return measure(roster,schedule.rounds);
}
export function rng(seed=1) { let s=(Number(seed)>>>0)||1;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;}; }
export function shuffle(a,random){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

// A min-cost degree-constrained bipartite graph is exactly decomposable into
// twelve perfect matchings. Unit pair capacities enforce unique partners.
export function generateFast(roster,seed=1,options={}) {
  const people=participants(roster),s=people.filter(a=>a.isMpdStudent),n=people.filter(a=>!a.isMpdStudent),anchor=s.find(a=>a.studentPairAnchor);
  if(usesStudentGroups(people)&&!options.baselineOnly)return null;
  if(anchor?.alternateStudentPartners)return null;
  if(s.length!==n.length && !(s.length===n.length+2&&anchor)) return null;
  const random=rng(seed);
  const left=shuffle(s.filter(a=>s.length===n.length||a!==anchor),random);
  const right=shuffle(s.length===n.length?n:[...n,anchor],random),m=left.length;
  if(m<ROUNDS)return null;
  let next=1;const L=left.map(()=>next++),LG=left.map(a=>a.level==="People leader"?next++:null),RG=right.map(a=>a.level==="People leader"?next++:null),R=right.map(()=>next++),sink=next++;
  const graph=Array.from({length:next},()=>[]);
  function edge(u,v,cap,cost){const a={to:v,rev:graph[v].length,cap,cost,initial:cap},b={to:u,rev:graph[u].length,cap:0,cost:-cost,initial:0};graph[u].push(a);graph[v].push(b);return a;}
  const total=ROUNDS*m,tieMax=total*16,auxWeight=options.preferAnchorLeaders?tieMax+1:0,careerWeight=options.preferAnchorLeaders?(ROUNDS+1)*auxWeight:tieMax+1,priorityWeight=(total+1)*careerWeight,coverageWeight=(ROUNDS+1)*priorityWeight,currentWeight=(people.filter(a=>a.level==="People leader").length+1)*coverageWeight;
  for(let i=0;i<m;i++){
    edge(0,L[i],ROUNDS,0);edge(R[i],sink,ROUNDS,0);
    if(LG[i]!==null){edge(L[i],LG[i],1,-coverageWeight);edge(L[i],LG[i],ROUNDS-1,0);}
    if(RG[i]!==null){edge(RG[i],R[i],1,-coverageWeight);edge(RG[i],R[i],ROUNDS-1,0);}
  }
  const pairEdges=[];
  for(let i=0;i<m;i++)for(let j=0;j<m;j++){
    const a=left[i],b=right[j],both=LG[i]!==null&&RG[j]!==null;
    if(!pairAllowed(a,b))continue;
    let score=(a.currentPeopleLeader&&b.currentPeopleLeader?currentWeight:0)+(careerPair(a,b)?careerWeight:0);
    if(options.preferAnchorLeaders&&a.studentPairAnchor&&b.currentPeopleLeader)score+=auxWeight;
    if((a.unemployedMatchingPriority&&b.employmentStatus==="Unemployed")||(b.unemployedMatchingPriority&&a.employmentStatus==="Unemployed"))score+=priorityWeight;
    pairEdges.push({i,j,edge:edge(both?LG[i]:L[i],both?RG[j]:R[j],1,-score+Math.floor(random()*16))});
  }
  let flow=0;
  while(flow<total){
    const dist=Array(next).fill(Infinity),prev=Array(next),inQ=Array(next).fill(false),q=[0];dist[0]=0;inQ[0]=true;
    for(let k=0;k<q.length;k++){
      const u=q[k];inQ[u]=false;
      graph[u].forEach((e,ei)=>{if(e.cap>0&&dist[u]+e.cost<dist[e.to]){dist[e.to]=dist[u]+e.cost;prev[e.to]=[u,ei];if(!inQ[e.to]){q.push(e.to);inQ[e.to]=true;}}});
    }
    if(!prev[sink])throw Error("Unable to construct twelve unique rounds for this partition.");
    let v=sink;while(v!==0){const [u,ei]=prev[v],e=graph[u][ei];e.cap--;graph[v][e.rev].cap++;v=u;}flow++;
  }
  const adj=Array.from({length:m},()=>new Set());for(const p of pairEdges)if(p.edge.cap===0)adj[p.i].add(p.j);
  const rounds=[];
  for(let rr=0;rr<ROUNDS;rr++){
    const match=new Map();
    function augment(i,seen){for(const j of shuffle([...adj[i]],random)){if(seen.has(j))continue;seen.add(j);if(!match.has(j)||augment(match.get(j),seen)){match.set(j,i);return true;}}return false;}
    for(const i of shuffle(left.map((_,i)=>i),random))if(!augment(i,new Set()))throw Error("Graph decomposition failed.");
    const pairs=[...match].map(([j,i])=>{adj[i].delete(j);return[left[i].id,right[j].id];});
    rounds.push({number:rr+1,pairs:shuffle(pairs,random)});
  }
  const schedule={id:`schedule-${Date.now()}-${seed}`,seed,rounds,method:"Exact bipartite optimization",optimizationStatus:"optimal"};
  schedule.metrics=validateSchedule(roster,schedule);return schedule;
}
export function circleSchedule(roster,seed=1){
  let a=shuffle(participants(roster),rng(seed)),rounds=[];
  for(let r=0;r<ROUNDS;r++) { const pairs=[];for(let i=0;i<a.length/2;i++)pairs.push([a[i].id,a[a.length-1-i].id]);rounds.push({number:r+1,pairs});a=[a[0],a[a.length-1],...a.slice(1,-1)]; }
  return {id:`schedule-${Date.now()}-${seed}`,seed,rounds,method:"Round-robin starting schedule",optimizationStatus:"feasible"};
}
