import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const html=readFileSync(new URL('../speed-networking-event/index.html',import.meta.url),'utf8'),script=readFileSync(new URL('../speed-networking-event/rounds.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>`#${m[1]}`);
const classes=()=>({values:new Set(),add(v){this.values.add(v);},remove(v){this.values.delete(v);},toggle(v,on){on?this.add(v):this.remove(v);}});
const fixture=(extra={})=>({eventId:'synthetic-event',runId:'synthetic-run',version:1,status:'live',isTest:true,currentRound:1,rounds:[{number:1,leadQuestion:'Synthetic question?',matches:[{station:1,names:['Alex Example','Taylor Example']}]}],...extra});
async function display(initial,{presentation=true,soundAvailable=true,initialNow=0,offset=0}={}){
 let now=initialNow,feed=structuredClone(initial),offline=false,row=feed.timer?{...feed.timer}:{status:'idle',remainingMs:300000,deadlineAt:null,version:0};
 const elements=new Map(ids.map(id=>[id,{hidden:false,value:'',textContent:'',innerHTML:'',classList:classes()}])),listeners={},intervals=[],audio={resumes:0,starts:0,stops:0},requests=[];
 const snapshot=()=>{const remaining=row.status==='running'?Math.max(0,row.deadlineAt-now-offset):row.remainingMs;return {...structuredClone(feed),serverNow:now+offset,timer:{...row,round:feed.currentRound,remainingMs:remaining,complete:remaining===0,status:remaining===0?'completed':row.status}};};
 class FakeAudioContext{destination={};resume(){audio.resumes++;return Promise.resolve();}async decodeAudioData(){return {};}createBufferSource(){return {connect(){},start(){audio.starts++;},stop(){audio.stops++;}};}}
 const storage=new Map();
 const context=vm.createContext({document:{body:{classList:classes()},querySelector(s){assert.ok(elements.has(s),s);return elements.get(s);},addEventListener(type,callback){listeners[type]=callback;}},location:{search:presentation?'?display=1':'',hash:'',pathname:'/speed-networking-event/'},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},history:{replaceState(){}},URLSearchParams,AbortSignal,AudioContext:FakeAudioContext,Date:{now:()=>now},setTimeout(){},setInterval:callback=>intervals.push(callback),fetch:async(url,options={})=>{
  if(String(url).includes('timer-chime.mp3'))return {ok:soundAvailable,arrayBuffer:async()=>new ArrayBuffer(8)};
  if(offline)throw Error('Offline');
  if(options.method==='POST'){requests.push({url,options});throw Error('The public display must never start the timer.');}
  return {ok:true,json:async()=>snapshot()};
 }});
 vm.runInContext(script,context);await new Promise(r=>setImmediate(r));
 return {get:s=>elements.get(s),audio,requests,snapshot,async startRemote(){row={status:'running',remainingMs:row.remainingMs,deadlineAt:now+offset+row.remainingMs,version:row.version+1};await context.poll();},advance(ms){now+=ms;intervals.forEach(f=>f());},async settle(){await new Promise(r=>setImmediate(r));},async poll(next){if(next){if(next.currentRound!==feed.currentRound||next.runId!==feed.runId)row={status:'idle',remainingMs:300000,deadlineAt:null,version:0};feed=structuredClone(next);if(next.timer)row={...next.timer};}await context.poll();},offline(v){offline=v;},visibleAgain(){listeners.visibilitychange();}};
}

test('the display follows admin starts; enabling sound never starts the clock',async()=>{
 const page=await display(fixture());page.advance(60000);assert.equal(page.get('#timer-value').textContent,'05:00');
 await page.get('#enable-timer-sound').onclick();page.advance(60000);assert.equal(page.get('#timer-value').textContent,'05:00');assert.equal(page.requests.length,0);
 await page.startRemote();page.advance(1000);assert.equal(page.get('#timer-value').textContent,'04:59');
 const publicView=await display(fixture(),{presentation:false});assert.equal(publicView.get('#enable-timer-sound').hidden,true);await publicView.get('#enable-timer-sound').onclick();assert.equal(publicView.requests.length,0);
});

test('refresh preserves server time and enabling sound does not restart the round',async()=>{
 const page=await display(fixture());await page.startRemote();page.advance(120000);
 const refreshed=await display(page.snapshot(),{initialNow:120000});assert.equal(refreshed.get('#timer-value').textContent,'03:00');await refreshed.get('#enable-timer-sound').onclick();assert.equal(refreshed.requests.length,0);refreshed.advance(1000);assert.equal(refreshed.get('#timer-value').textContent,'02:59');
});

test('clock skew is corrected and the approved chime plays once at zero',async()=>{
 const page=await display(fixture(),{offset:60000});await page.get('#enable-timer-sound').onclick();await page.startRemote();await page.settle();assert.equal(page.audio.starts,0);
 page.advance(299999);await page.settle();assert.equal(page.audio.starts,0);page.advance(1);await page.settle();assert.equal(page.audio.starts,1);assert.equal(page.get('#timer-value').textContent,'00:00');
 page.advance(10000);page.visibleAgain();await page.poll();await page.settle();assert.equal(page.audio.starts,1);
});

test('sound stays enabled for later rounds, which wait for the admin to start',async()=>{
 const first=fixture(),page=await display(first);await page.get('#enable-timer-sound').onclick();await page.startRemote();page.advance(300000);await page.settle();assert.equal(page.audio.starts,1);
 await page.poll(fixture({version:2,currentRound:2,rounds:[...first.rounds,{...first.rounds[0],number:2}]}));assert.equal(page.audio.stops,1);page.advance(60000);assert.equal(page.get('#timer-value').textContent,'05:00');assert.equal(page.get('#enable-timer-sound').textContent,'Timer sound enabled');
 await page.startRemote();page.advance(1000);page.get('#round-tabs').onclick({target:{dataset:{round:'1'}}});assert.equal(page.get('#timer-value').textContent,'04:59');assert.equal(page.get('#timer-label').textContent,'Round 2 time left');page.advance(299000);await page.settle();assert.equal(page.audio.starts,2);
});

test('breaks preserve remaining time and wait for the admin to resume the clock',async()=>{
 const page=await display(fixture());await page.startRemote();page.advance(100000);
 const paused={status:'paused',remainingMs:200000,deadlineAt:null,version:2};await page.poll(fixture({version:2,status:'break',timer:paused}));page.advance(600000);assert.equal(page.get('#timer-value').textContent,'03:20');
 await page.poll(fixture({version:3,timer:paused}));page.advance(60000);assert.equal(page.get('#timer-value').textContent,'03:20');await page.startRemote();page.advance(1000);assert.equal(page.get('#timer-value').textContent,'03:19');
});

test('reconnection and revisiting an expired timer never replay the alarm',async()=>{
 const page=await display(fixture());await page.get('#enable-timer-sound').onclick();await page.startRemote();page.offline(true);page.advance(300000);await page.settle();await page.poll();assert.equal(page.audio.starts,1);assert.match(page.get('#connection').textContent,/Reconnecting/);
 page.offline(false);await page.poll();await page.settle();assert.equal(page.audio.starts,1);
 const later=await display(page.snapshot(),{initialNow:300000});await later.get('#enable-timer-sound').onclick();await later.settle();assert.equal(later.audio.starts,0);
});

test('audio failure is reported without stopping the countdown started by the admin',async()=>{
 const page=await display(fixture(),{soundAvailable:false});await page.get('#enable-timer-sound').onclick();assert.equal(page.get('#timer-audio-status').hidden,false);await page.startRemote();page.advance(300000);await page.settle();assert.equal(page.get('#timer-value').textContent,'00:00');assert.equal(page.audio.starts,0);
});

test('waiting and finished hide the timer, and a new test run has a fresh clock',async()=>{
 const page=await display(fixture({status:'waiting',currentRound:0,rounds:[]}));assert.equal(page.get('#countdown').hidden,true);await page.poll(fixture({version:2}));await page.startRemote();page.advance(60000);
 await page.poll(fixture({version:3,runId:'new-synthetic-run'}));assert.equal(page.get('#timer-value').textContent,'05:00');await page.poll(fixture({version:4,status:'finished',currentRound:12}));assert.equal(page.get('#countdown').hidden,true);
});
