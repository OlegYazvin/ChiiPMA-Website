import {env} from "cloudflare:workers";
import {readState,writeState} from "../../../lib/store";
import {normalizeRoster,validateSchedule,participants} from "../../../lib/matching.mjs";
import {waitingState} from "../../../lib/public-state.mjs";
import {assignStations} from "../../../lib/stations.mjs";
import {emptyQuestionBank,normalizeQuestionBank,validateQuestionChange,randomTestQuestionAssignments} from "../../../lib/question-bank.mjs";
import {publicSnapshot} from "../../../lib/event-snapshot.mjs";
import {addNonparticipant} from "../../../lib/roster-candidates.mjs";
import {startAdminTimer} from "../../../lib/admin-timer.mjs";
import {reserveQrPeople,validateQrSlots} from "../../../lib/qr-slots.mjs";
import {assignExistingQrCard,reservedCardRows,validateExistingQrAssignments} from "../../../lib/reserved-card-assignment.mjs";
import {listPrivateFiles,uploadPrivateFile,downloadPrivateFile} from "../../../lib/private-library.mjs";
import {queueLateJoin} from "../../../lib/late-join.mjs";
import {queueWithdrawals} from "../../../lib/withdrawals.mjs";
export const dynamic="force-dynamic";
function json(d:any,status=200){return Response.json(d,{status,headers:{"Cache-Control":"no-store"}});}
async function feed(){
  if(!env.RESULTS_URL)throw Error("Results connection unavailable.");
  const r=await fetch(`${env.RESULTS_URL}/api/state`,{headers:{"Cache-Control":"no-cache"}});if(!r.ok)throw Error("The public display is temporarily unavailable.");return r.json() as Promise<any>;
}
async function participantService(path:string,body?:any){
  if(!env.RESULTS_URL||!env.RESULTS_WRITE_KEY)throw Error('Participant service unavailable.');
  const r=await fetch(`${env.RESULTS_URL}/api/manage/${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${env.RESULTS_WRITE_KEY}`,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined});
  const data=await r.json() as any;if(!r.ok)throw Object.assign(Error(data.error||'Participant service unavailable.'),{status:r.status});return data;
}
async function syncReservedPages(s:any){
 const reservations=reservedCardRows(s);
 if(reservations.length)await participantService('reserve-links',{rosterVersion:s.version,reservations});
}
async function savedWithReservedPages(s:any){
 try{await syncReservedPages(s);return s;}catch{return {...s,qrSyncWarning:'Attendee saved. Reserved QR updates are pending; open Personal pages to retry.'};}
}
function releasedParticipants(s:any,through:number){
 const ids=new Set(s.schedule.rounds.slice(0,through).flatMap((r:any)=>r.pairs.flat()));
 return s.roster.filter((a:any)=>ids.has(a.id)).map((a:any)=>({id:a.id,name:a.name}));
}
async function finishPending(s:any){
  const p=s.pending;
  const r=await fetch(`${env.RESULTS_URL}/api/publish`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${env.RESULTS_WRITE_KEY}`},body:JSON.stringify({expectedVersion:p.expectedPublicVersion,operationId:p.operationId,state:p.target,resetTest:!!p.resetTest,resetReal:!!p.resetReal,...p.resetReal?{}:{participantRoster:p.participantRoster||releasedParticipants(s,p.target.currentRound)}})});
  const data=await r.json() as any;if(!r.ok)throw Object.assign(Error(data.error||"Could not release the round. Retry the pending action."),{status:r.status});
  return writeState({...s,...p.resetReal?{testQuestionAssignments:null}:{},pending:null,live:data,locked:data.status!=="waiting"},s.version);
}
export async function GET(request:Request){try{
 const u=new URL(request.url);
 if(u.pathname==='/api/library')return json(await listPrivateFiles(env.BUCKET,u.searchParams.get('cursor')));
 if(u.pathname==='/api/library/download')return await downloadPrivateFile(env.BUCKET,u.searchParams.get('id'));
 if(u.pathname==='/api/event-backup'){
  const organizer=await readState(),results=await participantService('backup'),latest=await readState();
  if(organizer?.version!==latest?.version)return json({error:'The event changed during the backup. Retry once the current action finishes.'},409);
  return json({format:'chipma-event-backup-v1',exportedAt:new Date().toISOString(),organizer,results,sourceRepository:'https://github.com/OlegYazvin/ChiiPMA-Website',sourceDirectory:'.event-apps',privateFiles:'Download the private workspace and print files from Files & handoff.'});
 }
 if(u.pathname==='/api/live')return json(await feed());
 if(u.pathname==='/api/participant-admin'){const mode=u.searchParams.get('mode')==='test'?'test':'real';if(mode==='real'){const s=await readState();if(s)await syncReservedPages(s);}const [pages,feedback,reserved,archives]=await Promise.all([participantService('participants?mode='+mode),participantService('feedback?mode='+mode),mode==='real'?participantService('reservations'):Promise.resolve({reservePages:[]}),mode==='real'?participantService('restart-archives'):Promise.resolve({restartArchives:[]})]);return json({...pages,...feedback,...reserved,...archives});}
 if(u.pathname==='/api/restart-archive')return json(await participantService('restart-archive?id='+encodeURIComponent(u.searchParams.get('id')||'')));
 const s=await readState();return json(s?{...s,questionBank:normalizeQuestionBank(s.questionBank)}:{version:0,roster:[],schedule:null,locked:false,pending:null,live:waitingState(),questionBank:emptyQuestionBank()});
 }catch(e:any){return json({error:e.message},e.status||503);}}
export async function POST(request:Request){
  try{
    // The confirmed owner-private Sites gate protects every request, including
    // identity-less service access. Reject cross-origin browser writes as well.
    if(new URL(request.url).pathname==='/api/library/upload')return json(await uploadPrivateFile(env.BUCKET,request));
    if(Number(request.headers.get("content-length")||0)>1000000)return json({error:"Request too large."},413);
    const text=await request.text();if(text.length>1000000)return json({error:"Request too large."},413);
    const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)return json({error:"Cross-origin write rejected."},403);
    const b=JSON.parse(text),path=new URL(request.url).pathname;
    let s=await readState();
    if(path==="/api/initialize"){
      if(s)return json({error:"Already initialized."},409);
      const roster=normalizeRoster(b.roster);participants(roster);validateSchedule(roster,b.schedule);const planned=assignStations(b.schedule,roster),metrics=validateSchedule(roster,planned);
      return json(await writeState({roster,questionBank:normalizeQuestionBank(b.questionBank),schedule:{...planned,metrics},locked:false,pending:null,live:waitingState()},0));
    }
    if(!s)return json({error:"Import the initial event roster first."},409);
    if(b.expectedVersion!==s.version)return json({error:"This event changed in another tab. Refresh and retry."},409);
    if(path==='/api/timer/start')return json(await startAdminTimer(s,b,{
      readLive:feed,
      hostSession:()=>participantService('host-session',{}),
      startTimer:async(token:string,body:any)=>{
        const r=await fetch(`${env.RESULTS_URL}/api/timer/start`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
        const result=await r.json() as any;if(!r.ok)throw Object.assign(Error(result.error||'Unable to start the timer.'),{status:r.status});
      },
    }));
    if(path==='/api/participant-admin'){
      if(b.action==='sync')return json(await participantService('provision',{mode:b.mode==='test'?'test':'real',participants:s.live?.currentRound>0?releasedParticipants(s,s.live.currentRound):participants(s.roster).map(a=>({id:a.id,name:a.name}))}));
      if(b.action==='hostLink')return json(await participantService('host-session',{}));
      if(b.action==='access')return json(await participantService('access',{open:b.open}));
      return json({error:'Unknown participant action.'},400);
    }
    if(path==="/api/qr-reservations"){
      if(s.pending)return json({error:'Finish the pending round release first.'},409);
      const roster=normalizeRoster(reserveQrPeople(s.roster));
      if(s.schedule)validateSchedule(roster,s.schedule);
      if(roster.length!==s.roster.length)s=await writeState({...s,roster},s.version);
      return json(await savedWithReservedPages(s));
    }
    if(path==="/api/candidates"){
      const ready={...s,roster:normalizeRoster(reserveQrPeople(s.roster))};
      return json(await savedWithReservedPages(await writeState(addNonparticipant(ready,b.attendee),s.version)));
    }
    if(path==="/api/qr-assignment")return json(await savedWithReservedPages(await writeState(assignExistingQrCard(s,b.slot,b.attendeeId),s.version)));
    if(path==="/api/questions"){
      if(s.pending)return json({error:"Finish the pending round release before saving questions."},409);
      const questionBank=validateQuestionChange(s.questionBank,b.questionBank,s.live,s.testQuestionAssignments);
      questionBank.updated_at=new Date().toISOString();
      const testQuestionAssignments=s.live?.isTest?randomTestQuestionAssignments(questionBank,{previous:s.testQuestionAssignments,releasedRound:s.live.currentRound}):null;
      return json(await writeState({...s,questionBank,testQuestionAssignments},s.version));
    }
    if(path==="/api/save"){
      if(s.locked||s.pending)return json({error:"The roster and schedule are frozen after Start."},409);
      const live=await feed();if(live.currentRound>0)return json({error:"The event has already started."},409);
      // Attendance is a draft until a schedule is generated. Keep identity and
      // classification checks here; validateSchedule checks matching eligibility.
      const roster=normalizeRoster(b.roster);
      validateQrSlots(s.roster,roster);
      validateExistingQrAssignments({...s,roster});
      let schedule=null;if(b.schedule){validateSchedule(roster,b.schedule);const planned=assignStations(b.schedule,roster),metrics=validateSchedule(roster,planned);schedule={id:String(planned.id).slice(0,100),seed:Number(planned.seed),rounds:planned.rounds,stationPlan:planned.stationPlan,method:String(planned.method||"Generated").slice(0,100),optimizationStatus:String(planned.optimizationStatus||"feasible").slice(0,40),metrics};}
      return json(await savedWithReservedPages(await writeState({...s,roster,schedule},s.version)));
    }
    if(path==="/api/late-join"){
      const live=await feed();
      if(b.expectedPublicVersion!==live.version)return json({error:"The released round changed. Refresh and retry the late arrivals."},409);
      const next=queueLateJoin(s,live,b.ids);
      return json(await writeState(next,s.version));
    }
    if(path==="/api/withdrawals"){
      const live=await feed();
      if(b.expectedPublicVersion!==live.version)return json({error:"The released round changed. Refresh and regenerate the remaining rounds."},409);
      return json(await writeState(queueWithdrawals(s,live,b.ids,b.rounds),s.version));
    }
    if(path==="/api/control"){
      if(s.pending){
        if(b.action!=='resetReal')return json(await finishPending(s));
        if(b.confirmRestart!==true)return json({error:'Confirm Reset real event before continuing.'},400);
        s=await finishPending(s);
      }
      if(b.action==='resetReal'){
        if(b.confirmRestart!==true)return json({error:'Confirm Reset real event before continuing.'},400);
        const live=await feed();if(live.isTest||live.currentRound<1)return json({error:'Only a started real event can be reset.'},409);
        s=await writeState({...s,locked:true,pending:{operationId:crypto.randomUUID(),expectedPublicVersion:live.version,resetReal:true,target:waitingState()}},s.version);
        return json(await finishPending(s));
      }
      if(!s.schedule)return json({error:"Generate and save a schedule before starting."},409);
      validateSchedule(s.roster,s.schedule);
      const live=await feed();let status=live.status,round=live.currentRound,isTest=live.isTest===true,resetTest=false;
      if(['next','finish'].includes(b.action)&&!live.timer?.complete)return json({error:'The current round must run its full five-minute timer before advancing.'},409);
      if((b.action==="start"||b.action==="startTest")&&status==="waiting"){status="live";round=1;isTest=b.action==="startTest";}
      else if(b.action==="resetTest"&&isTest&&round>0){status="waiting";round=0;isTest=false;resetTest=true;}
      else if(b.action==="next"&&status==="live"&&round<12)round++;
      else if(b.action==="break"&&status==="live")status="break";
      else if(b.action==="resume"&&status==="break")status="live";
      else if(b.action==="finish"&&status==="live"&&round===12)status="finished";
      else return json({error:"That action is unavailable for the current round."},409);
      if(b.action==="startTest")s={...s,testQuestionAssignments:randomTestQuestionAssignments(s.questionBank)};
      else if(b.action==="start"||resetTest)s={...s,testQuestionAssignments:null};
      s=await writeState({...s,locked:true,pending:{operationId:crypto.randomUUID(),expectedPublicVersion:live.version,resetTest,target:publicSnapshot(s,status,round,isTest),participantRoster:resetTest?participants(s.roster).map(a=>({id:a.id,name:a.name})):releasedParticipants(s,round)}},s.version);
      return json(await finishPending(s));
    }
    return json({error:"Unknown endpoint."},404);
  }catch(e:any){if(request.body&&!request.bodyUsed){try{await request.body.cancel();}catch{}}return json({error:e.message||"Unable to save the event."},e.status||400);}
}
