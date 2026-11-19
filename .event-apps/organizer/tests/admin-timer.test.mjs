import test from 'node:test';
import assert from 'node:assert/strict';
import {startAdminTimer} from '../lib/admin-timer.mjs';
const fixture=()=>({state:{version:12,pending:null},body:{runId:'synthetic-run',round:3,expectedPublicVersion:7,timerVersion:2},live:{version:7,runId:'synthetic-run',currentRound:3,status:'live',timer:{version:2,status:'idle',remainingMs:300000,complete:false}}});
function service(live){const calls=[];return {calls,readLive:async()=>structuredClone(live),hostSession:async()=>{calls.push('authorize');return {url:'https://www.chipma.org/speed-networking-event/?display=1#host=synthetic-private-capability'};},startTimer:async(token,body)=>{calls.push({token,body});live.timer={...live.timer,version:3,status:'running',deadlineAt:123456789};}};}
test('the private proxy starts the current shared timer without returning its capability',async()=>{
 const {state,body,live}=fixture(),services=service(live),before=structuredClone(state),response=await startAdminTimer(state,{...body,duration:1},services);
 assert.deepEqual(state,before);assert.equal(response.timer.status,'running');assert.deepEqual(services.calls[1],{token:'synthetic-private-capability',body:{runId:'synthetic-run',round:3,expectedVersion:2}});assert(!JSON.stringify(response).includes('synthetic-private-capability'));
});
test('pending releases and stale run, round, feed, or timer versions never authorize a start',async()=>{
 const variants=[x=>x.state.pending={},x=>x.body.runId='old-run',x=>x.body.round=2,x=>x.body.expectedPublicVersion=6,x=>x.body.timerVersion=1,x=>x.live.status='break',x=>x.live.status='finished',x=>x.live.timer.status='running',x=>x.live.timer.complete=true];
 for(const modify of variants){const f=fixture();modify(f);const services=service(f.live);await assert.rejects(startAdminTimer(f.state,f.body,services),e=>e.status===409);assert.deepEqual(services.calls,[]);}
});
test('resuming uses the paused timer version and never sends a new duration',async()=>{
 const f=fixture();f.live.timer.status='paused';f.live.timer.remainingMs=175000;const services=service(f.live);await startAdminTimer(f.state,f.body,services);assert.deepEqual(services.calls[1].body,{runId:'synthetic-run',round:3,expectedVersion:2});
});
test('backend race conflicts propagate and malformed authorization stays private',async()=>{
 const f=fixture(),services=service(f.live);services.startTimer=async()=>{throw Object.assign(Error('Timer changed.'),{status:409});};await assert.rejects(startAdminTimer(f.state,f.body,services),e=>e.status===409);
 services.hostSession=async()=>({url:'not a URL'});await assert.rejects(startAdminTimer(f.state,f.body,services),e=>e.status===503&&e.message==='Timer authorization is temporarily unavailable.');
});
