import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const html=readFileSync(new URL('../speed-networking-event/index.html',import.meta.url),'utf8'),script=readFileSync(new URL('../speed-networking-event/rounds.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>`#${m[1]}`);
const classes=()=>({values:new Set(),add(v){this.values.add(v);},remove(v){this.values.delete(v);},toggle(v,on){on?this.add(v):this.remove(v);}});
const fixture=(extra={})=>({eventId:'synthetic-event',runId:'synthetic-run',version:1,status:'live',isTest:true,currentRound:1,rounds:[{number:1,leadQuestion:'Synthetic question?',matches:[{station:1,names:['Alex Example','Taylor Example']}]}],...extra});
async function display(initial,{host=true,soundAvailable=true,initialNow=0,offset=0}={}){
 let now=initialNow,feed=structuredClone(initial),offline=false,row=feed.timer?{...feed.timer}:{status:'idle',remainingMs:300000,deadlineAt:null,version:0};
 const elements=new Map(ids.map(id=>[id,{hidden:false,value:'',textContent:'',innerHTML:'',classList:classes()}])),listeners={},intervals=[],audio={resumes:0,starts:0,stops:0},requests=[];
 const snapshot=()=>{const remaining=row.status==='running'?Math.max(0,row.deadlineAt-now-offset):row.remainingMs;return {...structuredClone(feed),serverNow:now+offset,timer:{...row,round:feed.currentRound,remainingMs:remaining,complete:remaining===0,status:remaining===0?'completed':row.status}};};
 class FakeAudioContext{destination={};resume(){audio.resumes++;return Promise.resolve();}async decodeAudioData(){return {};}createBufferSource(){return {connect(){},start(){audio.starts++;},stop(){audio.stops++;}};}}
 const storage=new Map();
 const context=vm.createContext({document:{body:{classList:classes()},querySelector(s){assert.ok(elements.has(s),s);return elements.get(s);},addEventListener(type,callback){listeners[type]=callback;}},location:{search:'',hash:host?'#host=synthetic-host':'',pathname:'/speed-networking-event/'},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},history:{replaceState(){}},URLSearchParams,AbortSignal,AudioContext:FakeAudioContext,Date:{now:()=>now},setTimeout(){},setInterval:callback=>intervals.push(callback),fetch:async(url,options={})=>{
  if(String(url).includes('timer-chime.mp3'))return {ok:soundAvailable,arrayBuffer:async()=>new ArrayBuffer(8)};
  if(offline)throw Error('Offline');
  if(String(url).endsWith('/timer/start')){const body=JSON.parse(options.body);requests.push(body);assert.equal(options.headers.Authorization,'Bearer synthetic-host');assert.equal(body.expectedVersion,row.version);row={status:'running',remainingMs:row.remainingMs,deadlineAt:now+offset+row.remainingMs,version:row.version+1};const current=snapshot();return {ok:true,json:async()=>({runId:feed.runId,timer:current.timer,serverNow:current.serverNow})};}
  return {ok:true,json:async()=>snapshot()};
 }});
 vm.runInContext(script,context);await new Promise(r=>setImmediate(r));
 return {get:s=>elements.get(s),audio,requests,snapshot,advance(ms){now+=ms;intervals.forEach(f=>f());},async settle(){await new Promise(r=>setImmediate(r));},async poll(next){if(next){if(next.currentRound!==feed.currentRound||next.runId!==feed.runId)row={status:'idle',remainingMs:300000,deadlineAt:null,version:0};feed=structuredClone(next);if(next.timer)row={...next.timer};}await context.poll();},offline(v){offline=v;},visibleAgain(){listeners.visibilitychange();}};
}

test('only an authorized host starts the shared timer, and repeated clicks do not restart it',async()=>{
 const page=await display(fixture());page.advance(60000);assert.equal(page.get('#timer-value').textContent,'05:00');
 await page.get('#start-timer').onclick();assert.equal(page.requests.length,1);page.advance(1000);assert.equal(page.get('#timer-value').textContent,'04:59');await page.get('#start-timer').onclick();assert.equal(page.requests.length,1);
 const publicView=await display(fixture(),{host:false});assert.equal(publicView.get('#start-timer').hidden,true);await publicView.get('#start-timer').onclick();assert.equal(publicView.requests.length,0);
});

test('refresh preserves server time and sound can be enabled without restarting the round',async()=>{
 const page=await display(fixture());await page.get('#start-timer').onclick();page.advance(120000);
 const refreshed=await display(page.snapshot(),{initialNow:120000});assert.equal(refreshed.get('#timer-value').textContent,'03:00');assert.equal(refreshed.get('#start-timer').textContent,'Enable timer sound');await refreshed.get('#start-timer').onclick();assert.equal(refreshed.requests.length,0);refreshed.advance(1000);assert.equal(refreshed.get('#timer-value').textContent,'02:59');
});

test('clock skew is corrected and the approved chime plays once at zero, never at Start',async()=>{
 const page=await display(fixture(),{offset:60000});await page.get('#start-timer').onclick();await page.settle();assert.equal(page.audio.starts,0);assert.equal(page.audio.resumes,1);
 page.advance(299999);await page.settle();assert.equal(page.audio.starts,0);page.advance(1);await page.settle();assert.equal(page.audio.starts,1);assert.equal(page.get('#timer-value').textContent,'00:00');
 page.advance(10000);page.visibleAgain();await page.poll();await page.settle();assert.equal(page.audio.starts,1);
});

test('new rounds stay idle until started and cancel a prior sound; history does not reset time',async()=>{
 const first=fixture(),page=await display(first);await page.get('#start-timer').onclick();await page.settle();page.advance(300000);await page.settle();assert.equal(page.audio.starts,1);
 await page.poll(fixture({version:2,currentRound:2,rounds:[...first.rounds,{...first.rounds[0],number:2}]}));assert.equal(page.audio.stops,1);page.advance(60000);assert.equal(page.get('#timer-value').textContent,'05:00');await page.get('#start-timer').onclick();page.advance(1000);page.get('#round-tabs').onclick({target:{dataset:{round:'1'}}});assert.equal(page.get('#timer-value').textContent,'04:59');assert.equal(page.get('#timer-label').textContent,'Round 2 time left');
});

test('host breaks preserve server remaining time and require manual resume',async()=>{
 const page=await display(fixture());await page.get('#start-timer').onclick();page.advance(100000);
 const paused={status:'paused',remainingMs:200000,deadlineAt:null,version:2};await page.poll(fixture({version:2,status:'break',timer:paused}));page.advance(600000);assert.equal(page.get('#timer-value').textContent,'03:20');assert.equal(page.get('#start-timer').disabled,true);
 await page.poll(fixture({version:3,timer:paused}));page.advance(60000);assert.equal(page.get('#timer-value').textContent,'03:20');await page.get('#start-timer').onclick();page.advance(1000);assert.equal(page.get('#timer-value').textContent,'03:19');
});

test('reconnection and viewing the page do not replay an expired alarm',async()=>{
 const page=await display(fixture());await page.get('#start-timer').onclick();await page.settle();page.offline(true);page.advance(300000);await page.settle();await page.poll();assert.equal(page.audio.starts,1);assert.match(page.get('#connection').textContent,/Reconnecting/);
 page.offline(false);await page.poll();await page.settle();assert.equal(page.audio.starts,1);
 const later=await display(page.snapshot(),{initialNow:300000});await later.settle();assert.equal(later.audio.starts,0);
});

test('audio failure is reported without stopping the shared countdown',async()=>{
 const page=await display(fixture(),{soundAvailable:false});await page.get('#start-timer').onclick();await page.settle();assert.equal(page.get('#timer-audio-status').hidden,false);page.advance(300000);await page.settle();assert.equal(page.get('#timer-value').textContent,'00:00');assert.equal(page.audio.starts,0);
});

test('waiting and finished hide the timer, and a new test run resets it',async()=>{
 const page=await display(fixture({status:'waiting',currentRound:0,rounds:[]}));assert.equal(page.get('#countdown').hidden,true);await page.poll(fixture({version:2}));await page.get('#start-timer').onclick();page.advance(60000);
 await page.poll(fixture({version:3,runId:'new-synthetic-run'}));assert.equal(page.get('#timer-value').textContent,'05:00');await page.poll(fixture({version:4,status:'finished',currentRound:12}));assert.equal(page.get('#countdown').hidden,true);
});
