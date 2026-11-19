import {env} from "cloudflare:workers";
import {readState} from "../../../lib/store";
import {waitingState,sanitizePublicState,validateTransition} from "../../../lib/public-state.mjs";
import {ParticipantService,fail} from "../../../lib/participant-service.mjs";
export const dynamic="force-dynamic";
const allowedOrigins=new Set(['https://chipma.org','https://www.chipma.org']);
function headers(request:Request,isPublic=false){const origin=request.headers.get('origin');return {'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',Vary:'Origin',...(isPublic?{'Access-Control-Allow-Origin':'*'}:origin&&allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};}
function json(request:Request,data:any,status=200,isPublic=false){return Response.json(data,{status,headers:headers(request,isPublic)});}
const token=(request:Request)=>(request.headers.get('authorization')||'').replace(/^Bearer /,'');
function service(){return new ParticipantService(env.DB,env.PARTICIPANT_LINK_SECRET||env.RESULTS_WRITE_KEY);}
function visible(state:any){if(!state)return waitingState();return {...sanitizePublicState(state),version:state.version,updatedAt:state.updatedAt,runId:state.runId,attemptId:state.attemptId};}
async function root(request:Request){const enc=new TextEncoder(),actual=request.headers.get('authorization')||'';if(!env.RESULTS_WRITE_KEY)fail('Unauthorized.',401);const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(actual)),crypto.subtle.digest('SHA-256',enc.encode(`Bearer ${env.RESULTS_WRITE_KEY}`))]);const a=new Uint8Array(x),b=new Uint8Array(y);let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];if(mismatch)fail('Unauthorized.',401);}
function checkOrigin(request:Request){const origin=request.headers.get('origin');if(origin&&!allowedOrigins.has(origin))fail('Origin not allowed.',403);}
async function body(request:Request,max=12000){if(Number(request.headers.get('content-length')||0)>max)fail('Request too large.',413);const text=await request.text();if(text.length>max)fail('Request too large.',413);const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))fail('Provide a JSON object.');return data;}
export async function OPTIONS(request:Request){try{checkOrigin(request);return new Response(null,{status:204,headers:{...headers(request),'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});}catch(e:any){return json(request,{error:e.message},e.status||400);}}
export async function GET(request:Request){
 const path=new URL(request.url).pathname;
 try{
  const api=service();
  if(path==='/api/state'){const s=await readState();return json(request,{...visible(s),...await api.publicInfo(s||waitingState())},200,true);}
  checkOrigin(request);
  if(path==='/api/participant')return json(request,await api.personal(token(request)));
  await root(request);const state=await readState()||waitingState(),mode=new URL(request.url).searchParams.get('mode')==='test'?'test':'real';
  if(path==='/api/manage/participants')return json(request,await api.list(state,mode));
  if(path==='/api/manage/feedback')return json(request,await api.feedback(state,mode));
  if(path==='/api/manage/reservations')return json(request,await api.reservations());
  if(path==='/api/manage/backup')return json(request,await api.exportBackup());
  if(path==='/api/manage/restart-archives')return json(request,await api.restartArchives());
  if(path==='/api/manage/restart-archive')return json(request,await api.restartArchive(new URL(request.url).searchParams.get('id')));
  return json(request,{error:'Not found.'},404);
 }catch(e:any){return json(request,{error:e.message||'Unable to load event data.'},e.status||503,path==='/api/state');}
}
export async function POST(request:Request){
 const path=new URL(request.url).pathname;
 try{
  checkOrigin(request);const api=service();
  if(path==='/api/participant/contact')return json(request,await api.saveContact(token(request),await body(request)));
  const responseRound=path.match(/^\/api\/participant\/rounds\/(\d+)$/);
  if(responseRound)return json(request,await api.submit(token(request),Number(responseRound[1]),await body(request)));
  if(path==='/api/timer/start')return json(request,await api.timer(token(request),await readState()||waitingState(),await body(request)));
  await root(request);const b=await body(request,200000),stored=await readState(),previous=visible(stored);
  if(path==='/api/manage/provision'){await api.syncRoster(stored||waitingState(),b.participants,b.mode==='test'?'test':'real');return json(request,await api.list(stored||waitingState(),b.mode==='test'?'test':'real'));}
  if(path==='/api/manage/host-session')return json(request,await api.hostSession());
  if(path==='/api/manage/access')return json(request,await api.access(b.open));
  if(path==='/api/manage/reserve-links')return json(request,await api.syncReservations(b));
  if(path!=='/api/publish')return json(request,{error:'Not found.'},404);
  if(typeof b.operationId!=='string'||!b.operationId||b.operationId.length>100)fail('Invalid operation.');
  const next=sanitizePublicState(b.state),kind=b.resetReal===true?'resetReal':b.resetTest===true?'resetTest':'publish';
  if(stored?.operationId===b.operationId){if(JSON.stringify(sanitizePublicState(stored))!==JSON.stringify(next)||(stored.operationKind||'publish')!==kind)fail('Operation payload changed.',409);return json(request,{...previous,...await api.publicInfo(stored)});}
  if(b.expectedVersion!==previous.version)fail('Display changed. Refresh the host controls.',409);
  validateTransition(previous,next,{resetTest:b.resetTest===true,resetReal:b.resetReal===true});
  const prepared=await api.preparePublish({...previous,runId:stored?.runId},next,b),saved=await api.publish(previous,next,b,prepared);
  return json(request,{...visible(saved),...await api.publicInfo(saved)});
 }catch(e:any){return json(request,{error:e.message||'Unable to save event data.'},e.status||400);}
}
