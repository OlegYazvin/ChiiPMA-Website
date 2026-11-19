import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../public/participant-admin.mjs',import.meta.url),'utf8').replace('export function','function');
test('reserved cards remain labeled and copy their permanent URL even when a normal page has the same participant ID',async()=>{
 const nodes=new Map(),clipboard=[],prints=[];const $=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='#personal-mode'?'real':'',hidden:false});return nodes.get(id);};
 const data={participants:[{id:'qr-person-1',name:'New Synthetic Attendee',url:'https://www.chipma.org/speed-networking-event/participant/#normal-code',contactReady:false}],responses:[],reservePages:[1,2,3].map(slot=>({id:`qr-person-${slot}`,slot,name:slot===1?'New Synthetic Attendee':`Person ${slot}`,pending:slot!==1,url:`https://www.chipma.org/speed-networking-event/participant/#fixed-code-${slot}`})),accessOpen:true};
 const ctx=vm.createContext({document:{querySelector:$},navigator:{clipboard:{async writeText(s){clipboard.push(s);}}},window:{open(){return {opener:null,document:{write:html=>prints.push(html),close(){}},focus(){},print(){}};}},qrcode:()=>({addData(){},make(){},createSvgTag(){return '<svg></svg>';}})});
 vm.runInContext(code,ctx);const ui=ctx.mountParticipantAdmin({getState:()=>({version:1}),api:async()=>data,notice(){}});await ui.refresh();
 assert.equal($('#reserve-pages-section').hidden,false);assert.match($('#reserved-personal-cards').innerHTML,/Person 1/);assert.match($('#reserved-personal-cards').innerHTML,/Assigned to New Synthetic Attendee/);
 await $('#reserved-personal-cards').onclick({target:{closest:s=>s==='[data-copy]'?{dataset:{copy:'reserved:1'}}:null}});assert.equal(clipboard[0],data.reservePages[0].url);
 $('#print-reserve-pages').onclick();assert(prints[0].includes('<h2>Person 1</h2>'));assert(!prints[0].includes('<h2>New Synthetic Attendee</h2>'));assert(prints[0].includes('fixed-code-3'));
});
test('an unused card can be assigned to an existing unchecked attendee and updates the displayed owner',async()=>{
 const nodes=new Map(),writes=[],busyChanges=[];const $=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='#personal-mode'?'real':'',hidden:false});return nodes.get(id);};
 let state={version:4,roster:[{id:'existing',name:'Existing Synthetic Attendee',included:false},{id:'other',name:'Other Synthetic Attendee',included:true}],qrAssignments:{}},eventBusy=false,dirty=false;
 const data={participants:[],responses:[],reservePages:[1,2,3].map(slot=>({slot,id:`qr-person-${slot}`,pending:true,name:`Person ${slot}`,url:`https://example.test/#stable-code-${slot}`})),accessOpen:true};
 const ctx=vm.createContext({document:{querySelector:$},qrcode:()=>({addData(){},make(){},createSvgTag(){return '<svg></svg>';}})});
 vm.runInContext(code,ctx);
 const ui=ctx.mountParticipantAdmin({getState:()=>state,api:async(path,body)=>{
  if(path==='qr-assignment'){writes.push(JSON.parse(JSON.stringify(body)));data.reservePages[1]={...data.reservePages[1],id:'existing',name:state.roster[0].name,pending:false};return {...state,version:5,qrAssignments:{2:'existing'}};}
  return data;
 },notice(){},canAssign:()=>!eventBusy&&!dirty,onAssigned:next=>{state=next;},onAssignBusyChange:value=>{eventBusy=value;busyChanges.push(value);}});
 await ui.refresh();assert.match($('#reserved-personal-cards').innerHTML,/<option value="existing">Existing Synthetic Attendee/);
 const form={dataset:{assignSlot:'2'},elements:{attendeeId:{value:'existing'}}};const event={target:{closest:()=>form},preventDefault(){}};
 dirty=true;await $('#reserved-personal-cards').onsubmit(event);assert.equal(writes.length,0);
 dirty=false;await $('#reserved-personal-cards').onsubmit(event);
 assert.deepEqual(writes,[{expectedVersion:4,slot:2,attendeeId:'existing'}]);assert.deepEqual(busyChanges,[true,false]);
 assert.deepEqual(state.qrAssignments,{2:'existing'});assert.equal(state.roster[0].included,false);
 assert.match($('#reserved-personal-cards').innerHTML,/Assigned to Existing Synthetic Attendee/);
 assert.match($('#reserved-personal-cards').innerHTML,/stable-code-2/);
 assert(!$('#reserved-personal-cards').innerHTML.includes('<option value="existing">'));
});
