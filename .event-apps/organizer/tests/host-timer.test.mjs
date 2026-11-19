import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../public/host-timer.mjs',import.meta.url),'utf8').replaceAll('export ','');
function page(){let now=1000,busy=false,fail=false,hold=false,release;
 const nodes=Object.fromEntries(['host-timer-value','host-timer-status','start-round-timer'].map(id=>['#'+id,{}])),requests=[],messages=[],ticks=[];
 const state={version:20,pending:null,live:{runId:'synthetic-run',version:9,currentRound:1,status:'live',serverNow:101000,timer:{version:0,status:'idle',remainingMs:300000,deadlineAt:null,complete:false}}};
 const ctx=vm.createContext({document:{querySelector:s=>nodes[s]},Date:{now:()=>now},setInterval:f=>ticks.push(f)});vm.runInContext(code,ctx);
 const component=ctx.mountHostTimer({getState:()=>state,isBusy:()=>busy,setBusy:value=>busy=value,onLive:live=>state.live=live,notice:(...args)=>messages.push(args),api:async(path,body)=>{requests.push({path,body});if(path==='live')return structuredClone(state.live);if(hold)await new Promise(r=>release=r);if(fail)throw Error('Another tab started this timer.');return {...structuredClone(state.live),timer:{version:1,status:'running',remainingMs:300000,deadlineAt:now+100000+300000,complete:false}};}});component.render();
 return {state,nodes,requests,messages,render:component.render,click:()=>nodes['#start-round-timer'].onclick(),advance(ms){now+=ms;ticks.forEach(f=>f());},hold(){hold=true;},release(){release();},fail(){fail=true;},busy(value){busy=value;component.render();}};
}
test('starting in admin sends the current event and timer versions once',async()=>{
 const p=page();p.hold();const first=p.click();await p.click();assert.equal(p.requests.length,1);assert.equal(p.nodes['#start-round-timer'].disabled,true);p.release();await first;assert.equal(p.requests[0].path,'timer/start');assert.deepEqual(JSON.parse(JSON.stringify(p.requests[0].body)),{expectedVersion:20,expectedPublicVersion:9,runId:'synthetic-run',round:1,timerVersion:0});assert.equal(p.nodes['#start-round-timer'].textContent,'Timer running');
});
test('server clock offset drives the admin countdown without resetting it',async()=>{
 const p=page();await p.click();p.advance(123000);assert.equal(p.nodes['#host-timer-value'].textContent,'02:57');p.render();assert.equal(p.nodes['#host-timer-value'].textContent,'02:57');
});
test('waiting, paused event, pending releases, busy edits, and completed timers cannot start',async()=>{
 for(const modify of [p=>p.state.live.status='waiting',p=>p.state.live.status='break',p=>p.state.pending={},p=>p.busy(true),p=>p.state.live.timer.complete=true]){const p=page();modify(p);p.render();await p.click();assert.equal(p.requests.length,0);}
});
test('after a break the admin offers Resume timer and preserves remaining time',async()=>{
 const p=page();p.state.live.timer={version:2,status:'paused',remainingMs:170000,deadlineAt:null,complete:false};p.render();p.advance(60000);assert.equal(p.nodes['#host-timer-value'].textContent,'02:50');assert.equal(p.nodes['#start-round-timer'].textContent,'Resume timer');await p.click();assert.equal(p.requests[0].body.timerVersion,2);
});
test('a conflict refreshes live timer state and leaves the error visible',async()=>{
 const p=page();p.fail();await p.click();assert.deepEqual(p.requests.map(r=>r.path),['timer/start','live']);assert.match(p.messages[0][0],/Another tab/);assert.equal(p.nodes['#start-round-timer'].disabled,false);
});
