import {EVENT_ID,STATION_COUNT,waitingState,sanitizePublicState} from './public-state.mjs';

export const DURATION=300000,REAL_RUN=`${EVENT_ID}-real`;
export const SITE='https://www.chipma.org/speed-networking-event/';
export function fail(message,status=400){throw Object.assign(Error(message),{status});}
const encoder=new TextEncoder();
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const random=()=>encode(crypto.getRandomValues(new Uint8Array(24)));
const hash=async value=>encode(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
export function activeRun(state){return state?.status&&state.status!=='waiting'?(state.runId||(state.isTest?`${EVENT_ID}-legacy-test`:REAL_RUN)):null;}
export function timerView(row,round,now=Date.now()){
 if(!round)return null;
 const remaining=row?.status==='running'?Math.max(0,row.deadline_at-now):row?.remaining_ms??DURATION;
 const complete=!!row&&(row.status==='completed'||remaining===0);
 return {round,version:row?.version??0,status:complete?'completed':row?.status??'idle',remainingMs:complete?0:remaining,deadlineAt:row?.status==='running'?row.deadline_at:null,complete};
}
export function normalizeContacts(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Provide contact details.');
 const out={};for(const [key,max] of [['linkedin',2048],['email',254],['phone',80],['other',500]]){
  if(input[key]!=null&&typeof input[key]!=='string')fail('Contact details must be text.');
  const value=(input[key]||'').trim();if(value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('A contact field is too long or contains invalid characters.');out[key]=value;
 }
 if(out.linkedin){try{const u=new URL(out.linkedin);if(u.protocol!=='https:'||!['www.linkedin.com','linkedin.com'].includes(u.hostname)||!u.pathname.startsWith('/in/'))throw Error();u.search='';u.hash='';out.linkedin=u.href;}catch{fail('Use a full HTTPS LinkedIn profile URL.');}}
 if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))fail('Enter a valid email address.');
 return out;
}
const hasContacts=contacts=>Object.values(contacts||{}).some(v=>typeof v==='string'&&v.trim());

export class ParticipantService{
 constructor(db,key,{now=()=>Date.now()}={}){this.db=db;this.key=key;this.now=now;}
 stmt(sql,...args){return this.db.prepare(sql).bind(...args);}
 async first(sql,...args){return this.stmt(sql,...args).first();}
 async all(sql,...args){return (await this.stmt(sql,...args).all()).results;}
 async sign(value){
  if(!this.key)fail('Event access is unavailable.',503);
  this.signingKey??=crypto.subtle.importKey('raw',encoder.encode(this.key),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  return encode(await crypto.subtle.sign('HMAC',await this.signingKey,encoder.encode(value)));
 }
 async token(link){return this.sign('participant:v1:'+JSON.stringify([EVENT_ID,link.run_id,link.participant_id,link.nonce]));}
 async reserveToken(row){return this.sign('reserved-card:v1:'+JSON.stringify([EVENT_ID,row.slot,row.nonce]));}
 async reservations(){
  const rows=await this.all('SELECT * FROM qr_reservations ORDER BY slot');
  return {reservePages:await Promise.all(rows.map(async r=>({slot:r.slot,id:r.participant_id,name:r.name,pending:!r.claimed,url:SITE+'participant/#'+await this.reserveToken(r)})))};
 }
 async syncReservations(body){
  if(!Number.isSafeInteger(body.rosterVersion)||body.rosterVersion<1||!Array.isArray(body.reservations)||body.reservations.length!==3)fail('Provide the three reserved QR identities and roster version.');
  const slots=new Set(),names=new Set(),people=new Set();
  for(const a of body.reservations){const personId=a.participantId??a.id;if(![1,2,3].includes(a.qrSlot)||a.id!==`qr-person-${a.qrSlot}`||slots.has(a.qrSlot)||typeof a.name!=='string'||!a.name.trim()||a.name.length>160||names.has(a.name)||typeof a.qrPending!=='boolean'||a.qrPending&&(a.name!==`Person ${a.qrSlot}`||personId!==a.id)||typeof personId!=='string'||!personId.trim()||personId.length>100||people.has(personId)||personId!==a.id&&/^qr-person-[123]$/.test(personId))fail('Invalid reserved QR identity.');slots.add(a.qrSlot);names.add(a.name);people.add(personId);}
  const run=await this.ensureRun(REAL_RUN,'real'),started=JSON.parse(run.state_json).currentRound>0,statements=[];
  for(const a of body.reservations){
   const personId=a.participantId??a.id;
   let row=await this.first('SELECT * FROM qr_reservations WHERE slot=?',a.qrSlot);
   if(row&&row.roster_version>body.rosterVersion)fail('The reserved QR roster changed. Refresh and retry.',409);
   if(row?.claimed&&a.qrPending)fail('An assigned card cannot be reused for another attendee.',409);
   if(row?.claimed&&row.participant_id!==personId)fail('An assigned card cannot be reused for another attendee.',409);
   if(row&&row.roster_version===body.rosterVersion&&(row.participant_id!==personId||row.name!==a.name||!!row.claimed===a.qrPending))fail('The reserved QR update changed without a new roster version.',409);
   if(started&&row?.claimed&&row.name!==a.name)fail('Started participant identities cannot be replaced.',409);
   const duplicate=await this.first('SELECT id FROM participant_links WHERE run_id=? AND name=? AND participant_id<>?',REAL_RUN,a.name,personId);if(duplicate)fail('Reserved names must be unique in the event roster.');
   row??={slot:a.qrSlot,nonce:random()};const tokenHash=await hash(await this.reserveToken(row));
   statements.push(this.stmt('INSERT INTO qr_reservations (slot,participant_id,name,claimed,nonce,token_hash,roster_version) VALUES (?,?,?,?,?,?,?) ON CONFLICT(slot) DO UPDATE SET participant_id=excluded.participant_id,name=excluded.name,claimed=excluded.claimed,roster_version=excluded.roster_version WHERE excluded.roster_version>=qr_reservations.roster_version AND (qr_reservations.claimed=0 OR qr_reservations.participant_id=excluded.participant_id)',a.qrSlot,personId,a.name,a.qrPending?0:1,row.nonce,tokenHash,body.rosterVersion));
   if(!a.qrPending){
    let link=await this.first('SELECT * FROM participant_links WHERE run_id=? AND participant_id=?',REAL_RUN,personId);
    link??={id:await hash(JSON.stringify([REAL_RUN,personId])),run_id:REAL_RUN,participant_id:personId,nonce:random()};
    const normalHash=await hash(await this.token(link));
    statements.push(this.stmt('INSERT INTO participant_links (id,run_id,participant_id,name,nonce,token_hash,active) SELECT ?,?,?,?,?,?,0 WHERE EXISTS (SELECT 1 FROM qr_reservations WHERE slot=? AND roster_version=? AND claimed=1 AND participant_id=?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',link.id,REAL_RUN,personId,a.name,link.nonce,normalHash,a.qrSlot,body.rosterVersion,personId));
   }
  }
  await this.db.batch(statements);return this.reservations();
 }
 async ensureRun(id,kind,state=waitingState()){
  await this.stmt('INSERT OR IGNORE INTO event_runs (id,kind,state_json,access_open) VALUES (?,?,?,1)',id,kind,JSON.stringify(state)).run();
  return this.first('SELECT * FROM event_runs WHERE id=?',id);
 }
 async syncRoster(state,roster,mode='real',explicitRunId=null,{allowAdditions=false}={}){
  if(!Array.isArray(roster)||!roster.length||roster.length>STATION_COUNT*2)fail('Provide the actual scheduled participants.');
  const ids=new Set(),names=new Set();
  for(const a of roster){if(!a||typeof a.id!=='string'||!a.id||a.id.length>100||typeof a.name!=='string'||!a.name.trim()||a.name.length>180||ids.has(a.id)||names.has(a.name))fail('Participant IDs and names must be unique.');ids.add(a.id);names.add(a.name);}
  const runId=explicitRunId||(mode==='test'?activeRun(state):REAL_RUN);
  if(!runId||mode==='test'&&!state.isTest)fail('Start a rehearsal before generating test links.',409);
  const run=await this.ensureRun(runId,mode,mode==='test'?state:waitingState());
  const oldState=JSON.parse(run.state_json);
  if(oldState.currentRound>0){
   if(allowAdditions&&(state.currentRound!==oldState.currentRound+1||JSON.stringify(state.rounds.slice(0,oldState.currentRound))!==JSON.stringify(oldState.rounds)))fail('Late arrivals may only join the next unreleased round.',409);
   const expected=new Set((allowAdditions?state:oldState).rounds.flatMap(r=>r.matches.flatMap(p=>p.names)));
   if(expected.size!==names.size||[...expected].some(n=>!names.has(n)))fail('The started participant roster is frozen.',409);
  }
  const existing=await this.all('SELECT * FROM participant_links WHERE run_id=?',runId),byId=new Map(existing.map(a=>[a.participant_id,a]));
  if(oldState.currentRound>0&&existing.some(a=>a.active)){
   const proposed=new Map(roster.map(a=>[a.id,a]));
   const replaced=roster.some(a=>{
    const old=byId.get(a.id);
    return allowAdditions?(old&&old.name!==a.name)||existing.some(other=>other.name===a.name&&other.participant_id!==a.id):!old?.active||old.name!==a.name;
   });
   if(existing.some(a=>a.active&&proposed.get(a.participant_id)?.name!==a.name)||replaced)fail('Started participant identities cannot be replaced.',409);
  }
  const statements=oldState.currentRound>0?[]:[this.stmt('UPDATE participant_links SET active=0 WHERE run_id=?',runId)];
  for(const a of roster){let link=byId.get(a.id);if(!link){link={id:await hash(JSON.stringify([runId,a.id])),run_id:runId,participant_id:a.id,name:a.name,nonce:random()};link.token_hash=await hash(await this.token(link));}
   statements.push(this.stmt('INSERT INTO participant_links (id,run_id,participant_id,name,nonce,token_hash,active) VALUES (?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=1',link.id,runId,a.id,a.name.trim(),link.nonce,link.token_hash));
  }
  await this.db.batch(statements);return runId;
 }
 async list(state,mode='real'){
  const runId=mode==='test'&&state.isTest?activeRun(state):mode==='real'?REAL_RUN:null;
  if(!runId)return {participants:[],accessOpen:true,mode};
  const run=await this.first('SELECT * FROM event_runs WHERE id=?',runId);
  const links=await this.all('SELECT l.*,c.body AS contacts FROM participant_links l LEFT JOIN participant_contacts c ON c.link_id=l.id WHERE l.run_id=? AND l.active=1 ORDER BY l.name',runId);
  const participants=await Promise.all(links.map(async l=>({id:l.participant_id,name:l.name,url:SITE+'participant/#'+await this.token(l),contactReady:hasContacts(l.contacts?JSON.parse(l.contacts):null)})));
  return {participants,accessOpen:run?.access_open!==0,mode};
 }
 async access(open){if(typeof open!=='boolean')fail('Choose whether participant access is open.');await this.ensureRun(REAL_RUN,'real');await this.stmt('UPDATE event_runs SET access_open=? WHERE id=?',open?1:0,REAL_RUN).run();return {accessOpen:open};}
 async hostSession(){const row=await this.first("SELECT body FROM event_state WHERE id='event'"),state=row?JSON.parse(row.body):null;const payload=encode(encoder.encode(JSON.stringify({purpose:'timer',eventId:EVENT_ID,attemptId:state?.attemptId||(state?.isTest?state.runId:REAL_RUN),expiresAt:this.now()+12*3600000,nonce:random()})));return {url:SITE+'?display=1#host='+payload+'.'+await this.sign('host:'+payload)};}
 async verifyHost(token){
  try{const [payload,signature,...extra]=String(token).split('.');if(extra.length||!payload||!signature)throw Error();const expected=await this.sign('host:'+payload);if(signature!==expected)throw Error();const p=JSON.parse(new TextDecoder().decode(decode(payload)));if(p.purpose!=='timer'||p.eventId!==EVENT_ID||p.expiresAt<=this.now())throw Error();return p;}catch{fail('Open the host display from the private admin app to control the timer.',403);}
 }
 async publicInfo(state){
  const runId=activeRun(state),now=this.now();if(!runId)return {runId:null,timer:null,completedThroughRound:0,serverNow:now};
  const rows=await this.all('SELECT * FROM round_timers WHERE run_id=? ORDER BY round',runId);let completed=0;
  for(let i=1;i<=state.currentRound;i++){if(!timerView(rows.find(r=>r.round===i),i,now).complete)break;completed=i;}
  return {runId,timer:timerView(rows.find(r=>r.round===state.currentRound),state.currentRound,now),completedThroughRound:completed,serverNow:now};
 }
 async timer(token,state,body){
  const host=await this.verifyHost(token),runId=activeRun(state);
  if((host.attemptId||REAL_RUN)!==(state.attemptId||(state.isTest?runId:REAL_RUN)))fail('The event restarted. Refresh the admin timer controls.',409);
  if(state.status!=='live'||!runId||body.runId!==runId||body.round!==state.currentRound)fail('Refresh the host display for the current round.',409);
  await this.ensureRun(runId,state.isTest?'test':'real',state);
  await this.stmt("INSERT OR IGNORE INTO round_timers (run_id,round,version,status,remaining_ms,deadline_at) VALUES (?,?,0,'idle',?,NULL)",runId,state.currentRound,DURATION).run();
  const row=await this.first('SELECT * FROM round_timers WHERE run_id=? AND round=?',runId,state.currentRound),view=timerView(row,state.currentRound,this.now());
  if(view.complete||row.status==='running'||body.expectedVersion!==row.version)fail('The timer changed. Refresh the display.',409);
  const remaining=row.remaining_ms,deadline=this.now()+remaining;
  const result=await this.stmt("UPDATE round_timers SET status='running',deadline_at=?,version=version+1 WHERE run_id=? AND round=? AND version=? AND EXISTS (SELECT 1 FROM event_state WHERE id='event' AND version=?)",deadline,runId,state.currentRound,row.version,state.version).run();
  if(result.meta.changes!==1)fail('The round changed. Refresh the display.',409);
  return this.publicInfo(state);
 }
 async link(token){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('This personal link is invalid.',401);
  const digest=await hash(token);let link=await this.first('SELECT * FROM participant_links WHERE token_hash=? AND active=1',digest),reservation=null;
  if(!link){reservation=await this.first('SELECT * FROM qr_reservations WHERE token_hash=?',digest);if(reservation?.claimed)link=await this.first('SELECT * FROM participant_links WHERE run_id=? AND participant_id=?',REAL_RUN,reservation.participant_id);}
  if(!link&&!reservation)fail('This personal link is invalid or no longer participating.',401);
  const run=await this.first('SELECT * FROM event_runs WHERE id=?',link?.run_id||REAL_RUN);
  if(!run||!run.access_open)fail('These participant pages are closed.',410);
  return {link,run,state:JSON.parse(run.state_json),reservation};
 }
 async personal(token){
  const {link,run,state,reservation}=await this.link(token);
  if(!link)return {name:reservation.name,qrSlot:reservation.slot,isTest:false,status:'waiting',attemptId:state.attemptId||run.id,eventVersion:state.eventVersion||0,completedThroughRound:0,reservationPending:true,profile:{version:0,contacts:{linkedin:'',email:'',phone:'',other:''}},rounds:[]};
  const info=await this.publicInfo({...state,runId:run.id});
  const profile=await this.first('SELECT * FROM participant_contacts WHERE link_id=?',link.id);
  const own=await this.all('SELECT * FROM conversation_responses WHERE run_id=? AND participant_id=?',run.id,link.participant_id);
  const completed=(state.rounds||[]).filter(r=>r.number<=info.completedThroughRound),pairs=completed.map(r=>({r,pair:r.matches.find(p=>p.names.includes(link.name))})).filter(x=>x.pair);
  const partnerNames=pairs.map(({pair})=>pair.names.find(n=>n!==link.name));
  const partners=partnerNames.length?await this.all(`SELECT * FROM participant_links WHERE run_id=? AND active=1 AND name IN (${partnerNames.map(()=>'?').join(',')})`,run.id,...partnerNames):[];
  const byName=new Map(partners.map(l=>[l.name,l])),peerResponses=[];
  if(pairs.length){const parts=[],args=[];for(const {r,pair} of pairs){const peer=byName.get(pair.names.find(n=>n!==link.name));if(peer){parts.push('SELECT * FROM conversation_responses WHERE run_id=? AND round=? AND participant_id=?');args.push(run.id,r.number,peer.participant_id);}}if(parts.length)peerResponses.push(...await this.all(parts.join(' UNION ALL '),...args));}
  const mutual=pairs.filter(({r,pair})=>{const peer=byName.get(pair.names.find(n=>n!==link.name));return own.some(a=>a.round===r.number&&a.stay_in_touch===1)&&peerResponses.some(a=>a.round===r.number&&a.participant_id===peer?.participant_id&&a.stay_in_touch===1);});
  const mutualIds=mutual.map(({pair})=>byName.get(pair.names.find(n=>n!==link.name)).id);
  const contacts=mutualIds.length?await this.all(`SELECT link_id,body FROM participant_contacts WHERE link_id IN (${mutualIds.map(()=>'?').join(',')})`,...mutualIds):[];
  return {name:link.name,qrSlot:reservation?.slot??null,isTest:run.kind==='test',status:state.status,attemptId:state.attemptId||run.id,eventVersion:state.eventVersion||0,completedThroughRound:info.completedThroughRound,profile:{version:profile?.version??0,contacts:profile?JSON.parse(profile.body):{linkedin:'',email:'',phone:'',other:''}},rounds:pairs.map(({r,pair})=>{
   const partner=pair.names.find(n=>n!==link.name),peer=byName.get(partner),response=own.find(a=>a.round===r.number),connected=mutual.some(a=>a.r.number===r.number);
   return {number:r.number,station:pair.station,partner,leadQuestion:r.leadQuestion??null,response:response?{rating:response.rating,stayInTouch:response.stay_in_touch===1,submittedAt:response.submitted_at}:null,mutual:connected,contacts:connected?JSON.parse(contacts.find(c=>c.link_id===peer.id)?.body||'{}'):null};
  })};
 }
 async saveContact(token,body){
  const {link}=await this.link(token);if(!link)fail('Your organizer has not assigned this reserved card yet.',403);const contacts=normalizeContacts(body.contacts);
  if(!Number.isInteger(body.expectedVersion)||body.expectedVersion<0)fail('Refresh your contact details before saving.',409);
  const stamp=new Date(this.now()).toISOString();
  const result=body.expectedVersion===0?await this.stmt('INSERT OR IGNORE INTO participant_contacts (link_id,body,version,updated_at) VALUES (?,?,1,?)',link.id,JSON.stringify(contacts),stamp).run():await this.stmt('UPDATE participant_contacts SET body=?,version=version+1,updated_at=? WHERE link_id=? AND version=?',JSON.stringify(contacts),stamp,link.id,body.expectedVersion).run();
  if(result.meta.changes!==1)fail('Your contact details changed in another tab. Reload before saving.',409);
  return this.personal(token);
 }
 async submit(token,round,body){
  const {link,run,state}=await this.link(token);
  if(!link)fail('Your organizer has not assigned this reserved card yet.',403);
  const attemptId=state.attemptId||run.id;
  if((attemptId!==REAL_RUN||body.attemptId!==undefined)&&body.attemptId!==attemptId)fail('The event restarted. Reload your personal page before submitting.',409);
  if(!Number.isInteger(round)||round<1||round>12||!['frown','neutral','smile'].includes(body.rating)||typeof body.stayInTouch!=='boolean')fail('Choose a rating and Yes or No before submitting.');
  const info=await this.publicInfo({...state,runId:run.id}),pair=state.rounds?.find(r=>r.number===round)?.matches.find(p=>p.names.includes(link.name));
  if(round>info.completedThroughRound||!pair)fail('This conversation has not finished yet.',403);
  if(body.stayInTouch){const contact=await this.first('SELECT body FROM participant_contacts WHERE link_id=?',link.id);if(!contact||!hasContacts(JSON.parse(contact.body)))fail('Save at least one contact method before choosing Yes.');}
  const stamp=new Date(this.now()).toISOString();
  await this.stmt("INSERT OR IGNORE INTO conversation_responses (run_id,round,participant_id,rating,stay_in_touch,submitted_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM event_runs WHERE id=? AND COALESCE(json_extract(state_json,'$.attemptId'),id)=?)",run.id,round,link.participant_id,body.rating,body.stayInTouch?1:0,stamp,run.id,attemptId).run();
  const saved=await this.first("SELECT * FROM conversation_responses WHERE run_id=? AND round=? AND participant_id=? AND EXISTS (SELECT 1 FROM event_runs WHERE id=? AND COALESCE(json_extract(state_json,'$.attemptId'),id)=?)",run.id,round,link.participant_id,run.id,attemptId);
  if(!saved)fail('The event restarted. Reload your personal page before submitting.',409);
  if(saved.rating!==body.rating||!!saved.stay_in_touch!==body.stayInTouch)fail('This conversation was already submitted. Submissions are final.',409);
  return this.personal(token);
 }
 async feedback(state,mode='real'){
  const runId=mode==='test'&&state.isTest?activeRun(state):mode==='real'?REAL_RUN:null;if(!runId)return {responses:[]};
  const run=await this.first('SELECT * FROM event_runs WHERE id=?',runId);if(!run)return {responses:[]};const snapshot=JSON.parse(run.state_json);
  const rows=await this.all('SELECT r.*,l.name FROM conversation_responses r JOIN participant_links l ON l.run_id=r.run_id AND l.participant_id=r.participant_id WHERE r.run_id=? ORDER BY r.round,l.name',runId);
  return {responses:rows.map(r=>({round:r.round,name:r.name,partner:snapshot.rounds.find(a=>a.number===r.round)?.matches.find(p=>p.names.includes(r.name))?.names.find(n=>n!==r.name)||'',rating:r.rating,submittedAt:r.submitted_at}))};
 }
 async restartArchives(){
  const rows=await this.all("SELECT id,state_json FROM event_runs WHERE kind='real_archive' ORDER BY json_extract(state_json,'$.archivedAt') DESC");
  return {restartArchives:rows.map(row=>{const a=JSON.parse(row.state_json);return {id:row.id,archivedAt:a.archivedAt,roundsReleased:a.eventState.currentRound,responses:a.responses.length};})};
 }
 async exportBackup(){
  const names=['event_state','event_runs','participant_links','participant_contacts','conversation_responses','round_timers','qr_reservations'];
  const snapshot=await this.db.batch(names.map(name=>this.stmt(`SELECT * FROM ${name}`)));
  const tables=Object.fromEntries(names.map((name,i)=>[name,snapshot[i].results]));
  const participantUrls=await Promise.all(tables.participant_links.map(async row=>({id:row.participant_id,runId:row.run_id,name:row.name,active:!!row.active,url:SITE+'participant/#'+await this.token(row)})));
  const reservePages=await Promise.all(tables.qr_reservations.map(async row=>({slot:row.slot,id:row.participant_id,name:row.name,pending:!row.claimed,url:SITE+'participant/#'+await this.reserveToken(row)})));
  return {format:'chipma-results-backup-v1',eventId:EVENT_ID,exportedAt:new Date(this.now()).toISOString(),tables,participantUrls,reservePages};
 }
 async restartArchive(id){
  if(typeof id!=='string'||!/^real-archive-[A-Za-z0-9_-]{1,100}$/.test(id))fail('Choose an archived real-event attempt.');
  const row=await this.first("SELECT state_json FROM event_runs WHERE id=? AND kind='real_archive'",id);if(!row)fail('Archived event attempt not found.',404);
  return JSON.parse(row.state_json);
 }
 async preparePublish(previous,next,body){
  const oldRun=activeRun(previous),runId=next.status==='waiting'?null:previous.status==='waiting'?(next.isTest?`test-${body.operationId}`:REAL_RUN):oldRun;
  const timer=oldRun?await this.first('SELECT * FROM round_timers WHERE run_id=? AND round=?',oldRun,previous.currentRound):null;
  const finishingCurrent=previous.currentRound>0&&next.status==='finished'&&next.currentRound===previous.currentRound;
  const allowIncompleteFinish=body.endNow===true&&finishingCurrent;
  if(previous.currentRound>0&&!body.resetTest&&!body.resetReal&&(next.currentRound>previous.currentRound||next.status==='finished')&&!allowIncompleteFinish&&!timerView(timer,previous.currentRound,this.now()).complete)fail('The current round must run its full five-minute timer before advancing.',409);
  if(runId&&!finishingCurrent){if(!body.participantRoster)fail('The host must sync the scheduled participants before releasing this round.',409);await this.syncRoster({...next,runId},body.participantRoster,next.isTest?'test':'real',runId,{allowAdditions:previous.currentRound>0&&next.currentRound===previous.currentRound+1&&!body.resetTest&&!body.resetReal});}
  const real=await this.first('SELECT state_json FROM event_runs WHERE id=?',REAL_RUN),realAttemptId=body.resetReal?`real-${body.operationId}`:real?JSON.parse(real.state_json).attemptId||REAL_RUN:REAL_RUN;
  return {runId,oldRun,timer,realAttemptId};
 }
 async publish(previous,next,body,prepared){
  const {runId,oldRun,timer,realAttemptId}=prepared,now=this.now(),saved={...next,runId,attemptId:next.isTest?runId:realAttemptId,operationId:body.operationId,operationKind:body.resetReal?'resetReal':body.resetTest?'resetTest':'publish',updatedAt:new Date(now).toISOString(),version:previous.version+1};
  const timerCheck=oldRun?(timer?' AND EXISTS (SELECT 1 FROM round_timers WHERE run_id=? AND round=? AND version=?)':' AND NOT EXISTS (SELECT 1 FROM round_timers WHERE run_id=? AND round=?)'):'';
  const args=[JSON.stringify(saved),previous.version,...oldRun?(timer?[oldRun,previous.currentRound,timer.version]:[oldRun,previous.currentRound]):[]];
  const first=previous.version===0?this.stmt("INSERT OR IGNORE INTO event_state (id,version,body) VALUES ('event',1,?)",JSON.stringify(saved)):this.stmt("UPDATE event_state SET version=version+1,body=? WHERE id='event' AND version=?"+timerCheck,...args);
  const guard="EXISTS (SELECT 1 FROM event_state WHERE id='event' AND json_extract(body,'$.operationId')=?)",statements=[first];
  if(runId)statements.push(this.stmt(`UPDATE event_runs SET state_json=? WHERE id=? AND ${guard}`,JSON.stringify({...next,runId,attemptId:saved.attemptId,eventVersion:saved.version}),runId,body.operationId));
  if(timer&&next.status==='break'){
   const remaining=timer.status==='running'?Math.max(0,timer.deadline_at-now):timer.remaining_ms;
   statements.push(this.stmt(`UPDATE round_timers SET status=?,remaining_ms=?,deadline_at=NULL,version=version+1 WHERE run_id=? AND round=? AND ${guard}`,remaining===0?'completed':'paused',remaining,oldRun,previous.currentRound,body.operationId));
  }
  if(body.resetTest&&oldRun){
   statements.push(this.stmt(`UPDATE event_runs SET access_open=0 WHERE id=? AND ${guard}`,oldRun,body.operationId));
   statements.push(this.stmt(`DELETE FROM conversation_responses WHERE run_id=? AND ${guard}`,oldRun,body.operationId));
   statements.push(this.stmt(`DELETE FROM participant_contacts WHERE link_id IN (SELECT id FROM participant_links WHERE run_id=?) AND ${guard}`,oldRun,body.operationId));
  }
  if(body.resetReal){
   // Archive within the same transaction as the reset, including responses that
   // arrived immediately before it. Credentials and contacts remain untouched.
   statements.push(this.stmt(`INSERT INTO event_runs (id,kind,state_json,access_open) SELECT ?,'real_archive',json_object(
    'schema_version',1,'archivedAt',?,'attemptId',?,'eventState',json(?),
    'participants',json((SELECT json_group_array(json_object('id',participant_id,'name',name,'active',active)) FROM participant_links WHERE run_id=?)),
    'responses',json((SELECT json_group_array(json_object('round',round,'participant_id',participant_id,'rating',rating,'stay_in_touch',stay_in_touch,'submitted_at',submitted_at)) FROM conversation_responses WHERE run_id=?)),
    'timers',json((SELECT json_group_array(json_object('round',round,'version',version,'status',status,'remaining_ms',remaining_ms,'deadline_at',deadline_at)) FROM round_timers WHERE run_id=?))
   ),0 WHERE ${guard}`,`real-archive-${body.operationId}`,new Date(now).toISOString(),previous.attemptId||REAL_RUN,JSON.stringify(previous),REAL_RUN,REAL_RUN,REAL_RUN,body.operationId));
   statements.push(this.stmt(`UPDATE event_runs SET state_json=? WHERE id=? AND ${guard}`,JSON.stringify({...next,runId:REAL_RUN,attemptId:realAttemptId,eventVersion:saved.version}),REAL_RUN,body.operationId));
   statements.push(this.stmt(`DELETE FROM conversation_responses WHERE run_id=? AND ${guard}`,REAL_RUN,body.operationId));
   statements.push(this.stmt(`DELETE FROM round_timers WHERE run_id=? AND ${guard}`,REAL_RUN,body.operationId));
  }
  const result=await this.db.batch(statements);if(result[0].meta.changes!==1)fail('The round or timer changed. Refresh and retry.',409);
  return saved;
 }
}
