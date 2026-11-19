// Synthetic LOCAL end-to-end check. Never start/reset production for testing.
// Servers :8797/:8798 use isolated .wrangler/real-restart-e2e stores.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeRoster,generateFast} from '../lib/matching.mjs';
const admin='http://127.0.0.1:8797',results='http://127.0.0.1:8798';
async function request(base,path,body,token){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...body?{'Content-Type':'application/json'}:{},...token?{Authorization:'Bearer '+token}:{}},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
assert.equal((await request(admin,'live')).data.version,0,'Fresh LOCAL storage is required.');
const roster=normalizeRoster(Array.from({length:28},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<14,isStudent:i<14,level:'Senior',jobs:[],employmentStatus:'Employed',included:true})));
let response=await request(admin,'initialize',{roster,schedule:generateFast(roster,17)});assert.equal(response.status,200);let state=response.data;
async function post(path,body){const r=await request(admin,path,{expectedVersion:state.version,...body});assert.equal(r.status,200,JSON.stringify(r.data));if(path!=='participant-admin')state=r.data;return r.data;}
async function control(action,extra={}){return post('control',{action,...extra});}
async function startTimer(){const live=(await request(admin,'live')).data;const r=await request(admin,'timer/start',{expectedVersion:state.version,expectedPublicVersion:live.version,runId:live.runId,round:live.currentRound,timerVersion:live.timer.version});assert.equal(r.status,200,JSON.stringify(r.data));}
function finishTimer(){const checkout=fileURLToPath(new URL('../../networking-results/',import.meta.url));execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/real-restart-e2e','--command',"UPDATE round_timers SET deadline_at=1 WHERE status='running'"],{cwd:checkout,stdio:'ignore'});}
await post('participant-admin',{action:'sync',mode:'real'});await post('qr-reservations',{});await post('qr-assignment',{slot:1,attendeeId:'synthetic-0'});
const before=(await request(admin,'participant-admin?mode=real')).data,spare=before.reservePages[0].url.split('#')[1],original=structuredClone(state);
assert.equal((await request(results,'participant/contact',{expectedVersion:0,contacts:{email:'kept@example.test'}},spare)).status,200);
await control('start');assert.equal((await request(admin,'live')).data.timer.status,'idle');
assert.equal((await request(admin,'control',{expectedVersion:state.version,action:'next'})).status,409);
assert.equal((await request(admin,'control',{expectedVersion:state.version,action:'resetReal'})).status,400);
await control('resetReal',{confirmRestart:true});
assert.equal(state.live.status,'waiting');assert.equal(state.locked,false);assert.equal(state.live.currentRound,0);
for(const k of ['roster','schedule','questionBank','qrAssignments'])assert.deepEqual(state[k],original[k]);
let personal=(await request(results,'participant',null,spare)).data;assert.equal(personal.profile.contacts.email,'kept@example.test');assert.deepEqual(personal.rounds,[]);
await control('start');const oldAttempt=state.live.attemptId;await startTimer();
assert.equal((await request(admin,'control',{expectedVersion:state.version,action:'next'})).status,409);
finishTimer();personal=(await request(results,'participant',null,spare)).data;assert.equal(personal.rounds.length,1);
assert.equal((await request(results,'participant/rounds/1',{rating:'smile',stayInTouch:false,attemptId:personal.attemptId},spare)).status,200);
await control('next');await startTimer();await control('break');await control('resetReal',{confirmRestart:true});
let pages=(await request(admin,'participant-admin?mode=real')).data;assert.equal(pages.responses.length,0);assert.equal(pages.restartArchives.length,2);
const archive=(await request(admin,'restart-archive?id='+encodeURIComponent(pages.restartArchives[0].id))).data;assert.equal(archive.responses.length,1);assert.equal(archive.responses[0].rating,'smile');assert.equal(archive.timers.length,2);
assert.equal((await request(results,'manage/restart-archives')).status,401);assert.equal((await request(results,'manage/restart-archive?id='+pages.restartArchives[0].id)).status,401);
assert.deepEqual(pages.reservePages.map(a=>a.url),before.reservePages.map(a=>a.url));
assert.deepEqual(pages.participants.map(({contactReady,...a})=>a),before.participants.map(({contactReady,...a})=>a));
await control('start');assert.notEqual(state.live.attemptId,oldAttempt);
for(let round=1;round<=12;round++){
 await startTimer();assert.equal((await request(admin,'control',{expectedVersion:state.version,action:round===12?'finish':'next'})).status,409);finishTimer();
 if(round===1){assert.equal((await request(results,'participant/rounds/1',{rating:'smile',stayInTouch:false,attemptId:oldAttempt},spare)).status,409);personal=(await request(results,'participant',null,spare)).data;assert.equal(personal.rounds[0].response,null);assert.equal((await request(results,'participant/rounds/1',{rating:'neutral',stayInTouch:false,attemptId:personal.attemptId},spare)).status,200);}
 if(round<12)await control('next');
}
await control('finish');assert.equal(state.live.status,'finished');await control('resetReal',{confirmRestart:true});assert.equal(state.live.status,'waiting');
pages=(await request(admin,'participant-admin?mode=real')).data;assert.equal(pages.restartArchives.length,3);assert.deepEqual(pages.responses,[]);
personal=(await request(results,'participant',null,spare)).data;assert.equal(personal.profile.contacts.email,'kept@example.test');assert.deepEqual(personal.rounds,[]);
const feed=JSON.stringify((await request(results,'state')).data);for(const value of ['kept@example.test','restartArchives',spare])assert(!feed.includes(value));
console.log('Passed local HTTP flow: confirmed real restart before timer/during break/after round 12, editable attendance, preserved QR codes/contacts/questions/schedule, private response archives, stale-attempt rejection, and admin-controlled full five-minute advance gates.');
