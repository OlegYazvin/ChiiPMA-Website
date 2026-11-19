export const STATION_COUNT=21;

// Exact minimum-cost assignment, used when the conversation graph does not
// admit a fixed half of the attendees. Rows are pairs; columns are stations.
export function minimumAssignment(cost){
 const n=cost.length,u=Array(n+1).fill(0),v=Array(n+1).fill(0),p=Array(n+1).fill(0),way=Array(n+1).fill(0);
 for(let i=1;i<=n;i++){
  p[0]=i;let j0=0;const min=Array(n+1).fill(Infinity),used=Array(n+1).fill(false);
  do{
   used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;
   for(let j=1;j<=n;j++)if(!used[j]){const cur=cost[i0-1][j-1]-u[i0]-v[j];if(cur<min[j]){min[j]=cur;way[j]=j0;}if(min[j]<delta){delta=min[j];j1=j;}}
   for(let j=0;j<=n;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;
   j0=j1;
  }while(p[j0]!==0);
  do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0!==0);
 }
 const assignment=Array(n);for(let j=1;j<=n;j++)assignment[p[j]-1]=j-1;return assignment;
}
function fixedAnchors(rounds,roster){
 const adj=new Map();for(const r of rounds)for(const [a,b] of r.pairs){if(!adj.has(a))adj.set(a,new Set());if(!adj.has(b))adj.set(b,new Set());adj.get(a).add(b);adj.get(b).add(a);}
 const colors=new Map(),selected=[],students=new Set(roster.filter(a=>a.isMpdStudent).map(a=>a.id)),order=new Map(roster.map((a,i)=>[a.id,i]));
 const compare=(a,b)=>(order.get(a)??1e9)-(order.get(b)??1e9)||a.localeCompare(b);
 for(const id of adj.keys())if(!colors.has(id)){
  const groups=[[],[]],q=[id];colors.set(id,0);
  for(let k=0;k<q.length;k++){
   const a=q[k],color=colors.get(a);groups[color].push(a);
   for(const b of adj.get(a)){if(!colors.has(b)){colors.set(b,1-color);q.push(b);}else if(colors.get(b)===color)return null;}
  }
  if(groups[0].length!==groups[1].length)return null;
  const scores=groups.map(g=>g.filter(a=>students.has(a)).length);
  const choose=scores[1]>scores[0]||scores[1]===scores[0]&&compare([...groups[1]].sort(compare)[0],[...groups[0]].sort(compare)[0])<0?1:0;
  selected.push(...groups[choose]);
 }
 return selected.sort(compare);
}
export function assignStations(schedule,roster=[]){
 if(!schedule?.rounds?.length)throw Error('Generate conversations before assigning stations.');
 const rounds=schedule.rounds.map(r=>({...r,pairs:r.pairs.map(p=>[...p])})),n=rounds[0].pairs.length;
 if(n>STATION_COUNT)throw Error(`${STATION_COUNT} stations accommodate at most ${STATION_COUNT*2} attendees.`);
 if(rounds.some(r=>r.pairs.length!==n))throw Error('Each round must have the same number of conversations.');
 const anchors=fixedAnchors(rounds,roster),fixed=anchors&&anchors.length===n?new Map(anchors.map((id,i)=>[id,i+1])):null;
 if(!fixed)for(const r of rounds)r.pairs.sort((a,b)=>[...a].sort().join('\0').localeCompare([...b].sort().join('\0')));
 let previous=new Map();const continuous=new Set(rounds[0].pairs.flat());
 for(let ri=0;ri<rounds.length;ri++){
  const r=rounds[ri];let stations;
  if(fixed)stations=r.pairs.map(pair=>{const a=pair.filter(id=>fixed.has(id));if(a.length!==1)throw Error('Invalid fixed-station partition.');return fixed.get(a[0]);});
  else if(ri===0)stations=r.pairs.map((_,i)=>i+1);
  else{
   const cost=r.pairs.map(pair=>Array.from({length:n},(_,j)=>-pair.reduce((score,id)=>score+(previous.get(id)===j+1?1000+(continuous.has(id)?1:0):0),0)));
   stations=minimumAssignment(cost).map(j=>j+1);
  }
  const ordered=r.pairs.map((pair,i)=>({pair,station:stations[i]})).sort((a,b)=>a.station-b.station);
  r.pairs=ordered.map(x=>x.pair);r.stations=ordered.map(x=>x.station);
  const now=new Map();for(let i=0;i<r.pairs.length;i++)for(const id of r.pairs[i]){now.set(id,r.stations[i]);if(ri>0&&previous.get(id)!==r.stations[i])continuous.delete(id);}
  previous=now;
 }
 const stationPlan={method:fixed?'Fixed stations for one conversation group':'Maximum retention between rounds',anchors:fixed?[...fixed].map(([attendeeId,station])=>({attendeeId,station})):[]};
 return {...schedule,rounds,stationPlan};
}
export function validateStations(rounds){
 for(const r of rounds){
  if(!Array.isArray(r.stations)||r.stations.length!==r.pairs.length)throw Error('Every conversation needs a station.');
  if(r.stations.some(s=>!Number.isInteger(s)||s<1||s>STATION_COUNT)||new Set(r.stations).size!==r.stations.length)throw Error(`Stations must be distinct numbers from 1 through ${STATION_COUNT} in each round.`);
 }
}
export function measureStations(rounds){
 if(!rounds.some(r=>r.stations))return {};
 validateStations(rounds);let previous=null,stationStays=0;const stationary=new Set(rounds[0].pairs.flat());
 for(const r of rounds){const now=new Map();r.pairs.forEach((pair,i)=>pair.forEach(id=>{now.set(id,r.stations[i]);if(previous){if(previous.get(id)===r.stations[i])stationStays++;else stationary.delete(id);}}));previous=now;}
 const transitions=rounds.length-1,maximumStationStays=transitions*rounds[0].pairs.length;
 return {stationCount:STATION_COUNT,activeStations:rounds[0].pairs.length,stationStays,maximumStationStays,stationMovements:transitions*rounds[0].pairs.length*2-stationStays,stationaryAttendeeIds:[...stationary]};
}
