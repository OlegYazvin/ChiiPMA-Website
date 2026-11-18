import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html=readFileSync(new URL('../speed-networking-event/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../speed-networking-event/rounds.js',import.meta.url),'utf8');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(match=>`#${match[1]}`);
const classes=()=>({values:new Set(),add(value){this.values.add(value);},remove(value){this.values.delete(value);},toggle(value,on){on?this.add(value):this.remove(value);}});
const fixture=(overrides={})=>({eventId:'synthetic-event',version:1,status:'live',isTest:true,currentRound:1,rounds:[{number:1,leadQuestion:'What did you learn?',matches:[{station:1,names:['Alex Example','Taylor Example']}]}],...overrides});

async function display(initial){
 let now=0,feed=initial,offline=false;
 const elements=new Map(ids.map(id=>[id,{hidden:false,value:'',textContent:'',innerHTML:'',classList:classes()}]));
 const listeners={},intervals=[];
 const context=vm.createContext({
  document:{body:{classList:classes()},querySelector(selector){assert.ok(elements.has(selector),`Unknown element ${selector}`);return elements.get(selector);},addEventListener(type,callback){listeners[type]=callback;}},
  location:{search:''},URLSearchParams,AbortSignal,
  Date:{now:()=>now},
  fetch:async()=>{if(offline)throw Error('Offline');return {ok:true,json:async()=>structuredClone(feed)};},
  setTimeout:()=>{},setInterval:callback=>intervals.push(callback),
 });
 vm.runInContext(script,context);
 await new Promise(resolve=>setImmediate(resolve));
 return {
  get:selector=>elements.get(selector),
  advance(ms){now+=ms;for(const callback of intervals)callback();},
  async poll(next=feed){feed=next;await context.poll();},
  offline(value){offline=value;},
  visibleAgain(){listeners.visibilitychange();},
 };
}

test('loading or refreshing an active round starts a five-minute countdown',async()=>{
 const page=await display(fixture());
 assert.equal(page.get('#countdown').hidden,false);
 assert.equal(page.get('#timer-value').textContent,'05:00');
 page.advance(1000);
 assert.equal(page.get('#timer-value').textContent,'04:59');
 page.advance(119000);
 await page.poll();
 await page.poll(fixture({version:2}));
 page.get('#name-search').value='Alex';
 page.get('#name-search').oninput();
 assert.equal(page.get('#timer-value').textContent,'03:00');
 const refreshed=await display(fixture({version:2}));
 assert.equal(refreshed.get('#timer-value').textContent,'05:00');
});

test('a newly released round restarts the countdown; viewing history does not',async()=>{
 const first=fixture(),page=await display(first);
 page.advance(60000);
 await page.poll(fixture({version:2,currentRound:2,rounds:[...first.rounds,{number:2,leadQuestion:'What surprised you?',matches:first.rounds[0].matches}]}));
 assert.equal(page.get('#timer-value').textContent,'05:00');
 page.advance(1000);
 page.get('#round-tabs').onclick({target:{dataset:{round:'1'}}});
 assert.equal(page.get('#timer-value').textContent,'04:59');
 assert.equal(page.get('#timer-label').textContent,'Round 2 time left');
 assert.equal(page.get('#lead-question-text').textContent,first.rounds[0].leadQuestion);
});

test('countdown uses elapsed time, survives reconnects, and stops at zero',async()=>{
 const page=await display(fixture());
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
 page.offline(false);
 await page.poll();
 assert.equal(page.get('#timer-value').textContent,'00:00');
 assert.equal(page.get('#round-label').textContent,'Round 1 of 12');
});

test('host breaks pause the remaining time and resume continues it',async()=>{
 const page=await display(fixture());
 page.advance(60000);
 await page.poll(fixture({version:2,status:'break'}));
 page.advance(180000);
 assert.equal(page.get('#timer-value').textContent,'04:00');
 assert.equal(page.get('#timer-label').textContent,'Round 1 paused');
 await page.poll(fixture({version:3}));
 page.advance(1000);
 assert.equal(page.get('#timer-value').textContent,'03:59');
});

test('waiting and finished states hide the timer; a test reset starts fresh',async()=>{
 const waiting=fixture({status:'waiting',isTest:false,currentRound:0,rounds:[]}),page=await display(waiting);
 assert.equal(page.get('#countdown').hidden,true);
 await page.poll(fixture({version:2}));
 assert.equal(page.get('#timer-value').textContent,'05:00');
 page.advance(60000);
 await page.poll({...waiting,version:3});
 assert.equal(page.get('#countdown').hidden,true);
 await page.poll(fixture({version:4}));
 assert.equal(page.get('#timer-value').textContent,'05:00');
 await page.poll(fixture({version:5,status:'finished',currentRound:12}));
 assert.equal(page.get('#countdown').hidden,true);
});
