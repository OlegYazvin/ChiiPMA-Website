import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const code=readFileSync(new URL('../public/organizer.mjs',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace(/load\(\)\.then\(pollLive\)\.catch\(.*\);\s*$/,'');
const person=(id,included,extra={})=>({id,name:`Synthetic ${id}`,included,jobs:[],level:null,...extra});
function setup(roster){
 const nodes=new Map();
 const $=selector=>{
  if(!nodes.has(selector))nodes.set(selector,{disabled:false,hidden:false,classList:{toggle(){}},querySelectorAll:()=>[],addEventListener(){}});
  return nodes.get(selector);
 };
 const ctx=vm.createContext({document:{querySelector:$,querySelectorAll:()=>[]},fixture:structuredClone(roster),
  participants:r=>r.filter(a=>a.included&&!a.parityReserve),usesStudentGroups:()=>false,LEVELS:[],JOBS:[],effectiveQuestionForRound:()=>null,
  mountQuestionBank:()=>({busy:false,render(){}}),mountHostTimer:()=>({render(){}}),mountParticipantAdmin:()=>({refresh(){}}),mountFileLibrary:()=>({refresh(){}})});
 vm.runInContext(code,ctx);
 vm.runInContext("state={roster:fixture,schedule:null,locked:false,live:{status:'waiting',currentRound:0}};render();",ctx);
 return {$,ctx,snapshot:()=>JSON.parse(vm.runInContext('JSON.stringify({state,dirty})',ctx))};
}

test('bulk attendance clears selections, then selects all real attendees while leaving unassigned QR cards unchecked',()=>{
 const roster=[person('a',true,{isMpdStudent:true,teamId:'team-a'}),person('b',false),person('reserve',true,{parityReserve:true,studentOnlyPartners:true}),person('qr-person-1',false,{qrSlot:1,qrPending:true}),person('qr-person-2',false,{qrSlot:2,qrPending:false})];
 const {$,ctx,snapshot}=setup(roster);
 vm.runInContext("state.schedule={id:'saved-schedule'};",ctx);
 $('#deselect-all').onclick();
 assert(snapshot().state.roster.every(a=>a.included===false));
 assert.equal(snapshot().dirty,true);assert.equal(snapshot().state.schedule,null);
 assert.equal($('#deselect-all').disabled,true);assert.equal($('#select-all').disabled,false);
 assert.equal($('#participation-summary').textContent,'0 of 4 selected.');
 $('#select-all').onclick();
 const after=snapshot().state.roster;
 assert.deepEqual(after.map(a=>a.included),[true,true,true,false,true]);
 assert.deepEqual(after.map(({included,...a})=>a),roster.map(({included,...a})=>a));
 assert.equal($('#select-all').disabled,true);assert.equal($('#deselect-all').disabled,false);
 assert.equal($('#participation-summary').textContent,'4 of 4 selected.');
});

test('locked events and in-progress operations cannot change attendance through either bulk control',()=>{
 for(const condition of ['state.locked=true','busy=true','questions.busy=true','state.pending={operationId:"pending"}']){
  const {$,ctx,snapshot}=setup([person('a',true),person('b',false)]);
  vm.runInContext(`${condition};render();state.schedule={id:'keep-schedule'};`,ctx);
  assert.equal($('#select-all').disabled,true);assert.equal($('#deselect-all').disabled,true);
  $('#select-all').onclick();$('#deselect-all').onclick();
  assert.deepEqual(snapshot().state.roster.map(a=>a.included),[true,false]);
  assert.equal(snapshot().dirty,false);assert.equal(snapshot().state.schedule.id,'keep-schedule');
 }
});

test('selecting an already fully selected roster does not discard its schedule',()=>{
 const {$,ctx,snapshot}=setup([person('a',true),person('qr-person-1',false,{qrSlot:1,qrPending:true})]);
 vm.runInContext("state.schedule={id:'keep-schedule'};",ctx);
 $('#select-all').onclick();
 assert.equal(snapshot().dirty,false);assert.equal(snapshot().state.schedule.id,'keep-schedule');
});
test('Reset real event is available before the timer starts, confirms, and unlocks the returned roster',async()=>{
 const {$,ctx,snapshot}=setup([person('a',true)]),requests=[];let confirmed=false;
 ctx.window={confirm:()=>confirmed};ctx.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({roster:[person('a',true)],schedule:null,version:8,locked:false,live:{status:'waiting',currentRound:0}})};};
 vm.runInContext("state.version=6;state.locked=true;state.live={status:'live',currentRound:1,timer:{complete:false}};render();",ctx);
 assert.match($('#host-buttons').innerHTML,/data-action="resetReal">Reset real event/);
 assert.match($('#host-buttons').innerHTML,/data-action="next" disabled/);
 const event={target:{dataset:{action:'resetReal'}}};await $('#host-buttons').onclick(event);assert.equal(requests.length,0);
 confirmed=true;await $('#host-buttons').onclick(event);assert.deepEqual(requests,[{url:'/api/control',body:{expectedVersion:6,action:'resetReal',confirmRestart:true}}]);
 assert.equal(snapshot().state.locked,false);assert.equal(snapshot().state.live.currentRound,0);assert(!$('#host-buttons').innerHTML.includes('resetReal'));
});
test('the finished real event keeps Reset real event; rehearsals keep their separate Reset test control',()=>{
 const {$,ctx}=setup([person('a',true)]);
 vm.runInContext("state.locked=true;state.live={status:'finished',currentRound:12};render();",ctx);assert.match($('#host-buttons').innerHTML,/data-action="resetReal"/);
 vm.runInContext("state.live.isTest=true;render();",ctx);assert(!$('#host-buttons').innerHTML.includes('resetReal'));assert.match($('#host-buttons').innerHTML,/data-action="resetTest"/);
});
