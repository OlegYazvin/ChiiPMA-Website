import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html=readFileSync(new URL('../speed-networking-event/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../speed-networking-event/rounds.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(match=>`#${match[1]}`);
const classes=()=>({values:new Set(),add(value){this.values.add(value);},remove(value){this.values.delete(value);},toggle(value,on){on?this.add(value):this.remove(value);}});
const fixture=(overrides={})=>({eventId:'synthetic-event',version:1,status:'live',isTest:true,currentRound:1,rounds:[{number:1,leadQuestion:'What did you learn?',matches:[{station:1,names:['Alex Example','Taylor Example']}]}],...overrides});

async function display(initial,{soundAvailable=true}={}){
 let now=0,feed=initial,offline=false;
 const elements=new Map(ids.map(id=>[id,{hidden:false,value:'',textContent:'',innerHTML:'',classList:classes()}]));
 const listeners={},intervals=[],audio={resumes:0,starts:0,stops:0};
 class FakeAudioContext{
  destination={};
  resume(){audio.resumes++;return Promise.resolve();}
  async decodeAudioData(){return {syntheticBuffer:true};}
  createBufferSource(){return {connect(){},start(){audio.starts++;},stop(){audio.stops++;}};}
 }
 const context=vm.createContext({
  document:{body:{classList:classes()},querySelector(selector){assert.ok(elements.has(selector),`Unknown element ${selector}`);return elements.get(selector);},addEventListener(type,callback){listeners[type]=callback;}},
  location:{search:''},URLSearchParams,AbortSignal,AudioContext:FakeAudioContext,
  Date:{now:()=>now},
  fetch:async url=>{if(String(url).includes('timer-chime.mp3'))return {ok:soundAvailable,arrayBuffer:async()=>new ArrayBuffer(8)};if(offline)throw Error('Offline');return {ok:true,json:async()=>structuredClone(feed)};},
  setTimeout:()=>{},setInterval:callback=>intervals.push(callback),
 });
 vm.runInContext(script,context);
 await new Promise(resolve=>setImmediate(resolve));
 return {
  get:selector=>elements.get(selector),
  audio,
  async settle(){await new Promise(resolve=>setImmediate(resolve));},
  advance(ms){now+=ms;for(const callback of intervals)callback();},
  async poll(next=feed){feed=next;await context.poll();},
  offline(value){offline=value;},
  visibleAgain(){listeners.visibilitychange();},
 };
}

test('loading or refreshing leaves five minutes ready until Start timer is clicked',async()=>{
 const page=await display(fixture());
 assert.equal(page.get('#countdown').hidden,false);
 assert.equal(page.get('#timer-value').textContent,'05:00');
 assert.equal(page.get('#start-timer').disabled,false);
 assert.equal(page.get('#start-timer').textContent,'Start timer');
 page.advance(60000);
 await page.poll();
 assert.equal(page.get('#timer-value').textContent,'05:00');
 page.get('#start-timer').onclick();
 page.advance(1000);
 assert.equal(page.get('#timer-value').textContent,'04:59');
 assert.equal(page.get('#start-timer').disabled,true);
 page.get('#start-timer').onclick();
 page.advance(119000);
 await page.poll();
 await page.poll(fixture({version:2}));
 page.get('#name-search').value='Alex';
 page.get('#name-search').oninput();
 assert.equal(page.get('#timer-value').textContent,'03:00');
 const refreshed=await display(fixture({version:2}));
 refreshed.advance(60000);
 assert.equal(refreshed.get('#timer-value').textContent,'05:00');
 assert.equal(refreshed.get('#start-timer').disabled,false);
});

test('Start timer unlocks audio without playing; expiry plays the chime exactly once',async()=>{
 const page=await display(fixture());
 assert.equal(page.audio.resumes,0);
 page.get('#start-timer').onclick();
 assert.equal(page.audio.resumes,1);
 await page.settle();
 assert.equal(page.audio.starts,0);
 page.advance(299000);await page.settle();assert.equal(page.audio.starts,0);
 page.advance(1000);await page.settle();assert.equal(page.audio.starts,1);
 page.advance(10000);page.visibleAgain();await page.poll();await page.settle();
 assert.equal(page.audio.starts,1);
});

test('each new round can sound once and cancels the previous round sound',async()=>{
 const first=fixture(),page=await display(first);
 page.get('#start-timer').onclick();await page.settle();page.advance(300000);await page.settle();
 assert.equal(page.audio.starts,1);
 await page.poll(fixture({version:2,currentRound:2,rounds:[...first.rounds,{...first.rounds[0],number:2}]}));
 assert.equal(page.audio.stops,1);
 page.advance(300000);await page.settle();assert.equal(page.audio.starts,1);
 page.get('#start-timer').onclick();await page.settle();page.advance(300000);await page.settle();
 assert.equal(page.audio.starts,2);
});

test('an unavailable sound is reported while the countdown continues to zero',async()=>{
 const page=await display(fixture(),{soundAvailable:false});
 page.get('#start-timer').onclick();await page.settle();
 assert.equal(page.get('#timer-audio-status').hidden,false);
 assert.match(page.get('#timer-audio-status').textContent,/sound is unavailable/);
 page.advance(300000);await page.settle();
 assert.equal(page.get('#timer-value').textContent,'00:00');
 assert.equal(page.audio.starts,0);
});

test('a newly released round waits for Start timer; viewing history preserves the countdown',async()=>{
 const first=fixture(),page=await display(first);
 page.get('#start-timer').onclick();
 page.advance(60000);
 await page.poll(fixture({version:2,currentRound:2,rounds:[...first.rounds,{number:2,leadQuestion:'What surprised you?',matches:first.rounds[0].matches}]}));
 assert.equal(page.get('#timer-value').textContent,'05:00');
 page.advance(60000);
 assert.equal(page.get('#timer-value').textContent,'05:00');
 assert.equal(page.get('#start-timer').disabled,false);
 page.get('#start-timer').onclick();
 page.advance(1000);
 page.get('#round-tabs').onclick({target:{dataset:{round:'1'}}});
 assert.equal(page.get('#timer-value').textContent,'04:59');
 assert.equal(page.get('#timer-label').textContent,'Round 2 time left');
 assert.equal(page.get('#lead-question-text').textContent,first.rounds[0].leadQuestion);
});

test('countdown uses elapsed time, survives reconnects, and stops at zero',async()=>{
 const page=await display(fixture());
 page.get('#start-timer').onclick();
 page.offline(true);
 page.advance(290000);
 await page.poll();
 assert.equal(page.get('#timer-value').textContent,'00:10');
 assert.match(page.get('#connection').textContent,/Reconnecting/);
 page.advance(30000);
 page.visibleAgain();
 assert.equal(page.get('#timer-value').textContent,'00:00');
 assert.equal(page.get('#timer-label').textContent,'Time is up');
 assert.equal(page.get('#countdown').classList.values.has('complete'),true);
 assert.equal(page.get('#start-timer').disabled,true);
 page.get('#start-timer').onclick();
 page.offline(false);
 await page.poll();
 assert.equal(page.get('#timer-value').textContent,'00:00');
 assert.equal(page.get('#round-label').textContent,'Round 1 of 12');
});

test('host breaks pause the timer and require a manual resume',async()=>{
 const page=await display(fixture());
 page.get('#start-timer').onclick();
 page.advance(60000);
 await page.poll(fixture({version:2,status:'break'}));
 page.advance(180000);
 assert.equal(page.get('#timer-value').textContent,'04:00');
 assert.equal(page.get('#timer-label').textContent,'Round 1 paused');
 assert.equal(page.get('#start-timer').disabled,true);
 page.get('#start-timer').onclick();
 await page.poll(fixture({version:3}));
 page.advance(60000);
 assert.equal(page.get('#timer-value').textContent,'04:00');
 assert.equal(page.get('#start-timer').textContent,'Resume timer');
 assert.equal(page.get('#start-timer').disabled,false);
 page.get('#start-timer').onclick();
 page.advance(1000);
 assert.equal(page.get('#timer-value').textContent,'03:59');
});

test('waiting and finished states hide the timer; test resets leave the new timer idle',async()=>{
 const waiting=fixture({status:'waiting',isTest:false,currentRound:0,rounds:[]}),page=await display(waiting);
 assert.equal(page.get('#countdown').hidden,true);
 assert.equal(page.get('#round-layout').classList.values.has('has-timer'),false);
 page.get('#start-timer').onclick();
 await page.poll(fixture({version:2}));
 assert.equal(page.get('#timer-value').textContent,'05:00');
 assert.equal(page.get('#round-layout').classList.values.has('has-timer'),true);
 page.get('#start-timer').onclick();
 page.advance(60000);
 await page.poll({...waiting,version:3});
 assert.equal(page.get('#countdown').hidden,true);
 await page.poll(fixture({version:4}));
 page.advance(60000);
 assert.equal(page.get('#timer-value').textContent,'05:00');
 assert.equal(page.get('#start-timer').disabled,false);
 await page.poll(fixture({version:5,status:'finished',currentRound:12}));
 assert.equal(page.get('#countdown').hidden,true);
});
