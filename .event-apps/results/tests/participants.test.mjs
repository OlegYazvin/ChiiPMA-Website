import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {ParticipantService,DURATION,REAL_RUN,activeRun} from '../lib/participant-service.mjs';
import {waitingState,sanitizePublicState,validateTransition} from '../lib/public-state.mjs';

class Database{
 constructor(){this.raw=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())this.raw.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));}
 prepare(sql){const database=this;return {bind(...args){return {sql,async first(){return database.raw.prepare(sql).get(...args)||null;},async all(){return {results:database.raw.prepare(sql).all(...args)};},async run(){return {meta:{changes:Number(database.raw.prepare(sql).run(...args).changes)}};}};}};}
 async batch(statements){this.raw.exec('BEGIN');try{const out=[];for(const s of statements)out.push(/^SELECT\b/i.test(s.sql)?await s.all():await s.run());this.raw.exec('COMMIT');return out;}catch(e){this.raw.exec('ROLLBACK');throw e;}}
}
async function fixture(count=14){
 const db=new Database();let now=1000000000000,state=waitingState();const api=new ParticipantService(db,'synthetic-test-only-key',{now:()=>now});
 const roster=Array.from({length:count},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Person ${i}`}));let order=[...roster];const rounds=[];
 for(let r=1;r<=12;r++){rounds.push({number:r,leadQuestion:`Synthetic question ${r}`,matches:Array.from({length:count/2},(_,i)=>({pairNumber:i+1,station:i+1,names:[order[i].name,order[count-1-i].name]}))});order=[order[0],order.at(-1),...order.slice(1,-1)];}
 async function publish(next,{resetTest=false,resetReal=false}={}){validateTransition(state,next,{resetTest,resetReal});const body={operationId:crypto.randomUUID(),resetTest,resetReal,participantRoster:roster};const prepared=await api.preparePublish(state,next,body);state=await api.publish(state,next,body,prepared);return state;}
 const snapshot=(round=1,isTest=false,status='live')=>({...waitingState(),currentRound:round,isTest,status,rounds:rounds.slice(0,round)});
 const token=p=>p.url.split('#')[1];
 async function links(mode='real'){return (await api.list(state,mode)).participants;}
 const host=(await api.hostSession()).url.split('#host=')[1];
 async function start(){const view=await api.publicInfo(state),currentHost=(await api.hostSession()).url.split('#host=')[1];return api.timer(currentHost,state,{runId:activeRun(state),round:state.currentRound,expectedVersion:view.timer.version});}
 return {api,db,roster,rounds,host,snapshot,token,links,start,publish,get state(){return state;},tick(ms){now+=ms;}};
}

test('42 participants can complete a released round with station 21 on both personal pages',async()=>{
 const f=await fixture(42);await f.api.syncRoster(f.state,f.roster);const links=await f.links();assert.equal(links.length,42);
 const next=sanitizePublicState(f.snapshot());assert.equal(next.rounds[0].matches.length,21);const pair=next.rounds[0].matches.at(-1);assert.equal(pair.station,21);
 await f.publish(next);const tokens=pair.names.map(name=>f.token(links.find(p=>p.name===name)));
 for(const token of tokens)assert.deepEqual((await f.api.personal(token)).rounds,[]);
 await f.start();f.tick(DURATION);
 for(const [i,token] of tokens.entries()){
  const page=await f.api.personal(token);assert.equal(page.completedThroughRound,1);assert.equal(page.rounds.length,1);assert.equal(page.rounds[0].station,21);assert.equal(page.rounds[0].partner,pair.names[1-i]);
 }
});

test('roster sync rejects 44 participants and duplicate identities without replacing the valid roster',async()=>{
 const f=await fixture(42);await f.api.syncRoster(f.state,f.roster);const before=await f.links();
 const tooMany=[...f.roster,{id:'synthetic-42',name:'Synthetic Person 42'},{id:'synthetic-43',name:'Synthetic Person 43'}];
 await assert.rejects(f.api.syncRoster(f.state,tooMany),/actual scheduled participants/);
 await assert.rejects(f.api.syncRoster(f.state,f.roster.map((p,i)=>i===41?{...p,id:f.roster[0].id}:p)),/unique/);
 await assert.rejects(f.api.syncRoster(f.state,f.roster.map((p,i)=>i===41?{...p,name:f.roster[0].name}:p)),/unique/);
 assert.deepEqual(await f.links(),before);
});

test('released rounds reject station 22, duplicate stations or attendees, and a 22nd match',async()=>{
 const f=await fixture(42);
 const invalid=edit=>{const next=f.snapshot();next.rounds=structuredClone(next.rounds);edit(next.rounds[0].matches);return next;};
 assert.throws(()=>sanitizePublicState(invalid(matches=>{matches.at(-1).station=22;})),/Stations must be unique/);
 assert.throws(()=>sanitizePublicState(invalid(matches=>{matches.at(-1).station=20;})),/Stations must be unique/);
 assert.throws(()=>sanitizePublicState(invalid(matches=>{matches.at(-1).names[0]=matches[0].names[0];})),/Duplicate attendee/);
 assert.throws(()=>sanitizePublicState(invalid(matches=>{matches.push({station:22,names:['Synthetic Person 42','Synthetic Person 43']});})),/Invalid round/);
});

test('normal links are stable, contact fields start blank, and no future round is returned',async()=>{
 const f=await fixture();await f.api.syncRoster(f.state,f.roster);const before=await f.links();await f.api.syncRoster(f.state,f.roster);assert.deepEqual(await f.links(),before);
 const t=f.token(before[0]),page=await f.api.personal(t);assert.deepEqual(page.profile.contacts,{linkedin:'',email:'',phone:'',other:''});assert.deepEqual(page.rounds,[]);
 await f.publish(f.snapshot());assert.equal((await f.api.personal(t)).rounds.length,0);await assert.rejects(f.api.submit(t,1,{rating:'smile',stayInTouch:false}),/not finished/);
 await assert.rejects(f.api.personal('not-a-real-token'),/invalid/);await assert.rejects(f.api.verifyHost(t),/host display/);
});

test('the authoritative timer requires all five minutes and preserves pauses across refreshes',async()=>{
 const f=await fixture();await f.publish(f.snapshot());await assert.rejects(f.api.preparePublish(f.state,f.snapshot(2),{operationId:'early',participantRoster:f.roster}),/full five-minute/);
 await f.start();await assert.rejects(f.start(),/timer changed/);f.tick(100000);
 await f.publish({...f.state,status:'break'});f.tick(1000000);assert.equal((await f.api.publicInfo(f.state)).timer.remainingMs,200000);assert.equal((await f.api.publicInfo(f.state)).completedThroughRound,0);
 await f.publish({...f.state,status:'live'});assert.equal((await f.api.publicInfo(f.state)).timer.status,'paused');await f.start();f.tick(199999);assert.equal((await f.api.publicInfo(f.state)).completedThroughRound,0);f.tick(1);assert.equal((await f.api.publicInfo(f.state)).completedThroughRound,1);
 await f.publish(f.snapshot(2));assert.equal((await f.api.publicInfo(f.state)).timer.status,'idle');assert.equal((await f.api.publicInfo(f.state)).timer.remainingMs,DURATION);
});

test('contact exchange needs two submitted Yes choices, independent of face ratings; submissions are final',async()=>{
 const f=await fixture();await f.publish(f.snapshot());const links=await f.links(),names=f.rounds[0].matches[0].names,a=links.find(l=>l.name===names[0]),b=links.find(l=>l.name===names[1]),ta=f.token(a),tb=f.token(b);
 await f.start();f.tick(DURATION);await assert.rejects(f.api.submit(ta,1,{rating:'smile',stayInTouch:true}),/contact method/);
 await f.api.saveContact(ta,{expectedVersion:0,contacts:{email:'a@example.test'}});await f.api.saveContact(tb,{expectedVersion:0,contacts:{email:'b@example.test'}});
 await f.api.submit(ta,1,{rating:'frown',stayInTouch:true});let page=await f.api.personal(ta);assert.equal(page.rounds[0].mutual,false);assert(!JSON.stringify(page).includes('b@example.test'));
 await f.api.submit(tb,1,{rating:'smile',stayInTouch:true});page=await f.api.personal(ta);assert.equal(page.rounds[0].contacts.email,'b@example.test');assert.equal(page.rounds[0].response.rating,'frown');
 const other=await f.api.personal(tb);assert.equal(other.rounds[0].contacts.email,'a@example.test');assert(!JSON.stringify(other).includes('frown'));
 await f.api.submit(ta,1,{rating:'frown',stayInTouch:true});await assert.rejects(f.api.submit(ta,1,{rating:'smile',stayInTouch:false}),/final/);
 assert.equal((await f.api.feedback(f.state)).responses.length,2);await assert.rejects(f.api.saveContact(ta,{expectedVersion:0,contacts:{email:'changed@example.test'}}),/another tab/);
 await f.api.saveContact(ta,{expectedVersion:1,contacts:{email:'updated@example.test'}});assert.equal((await f.api.personal(tb)).rounds[0].contacts.email,'updated@example.test');
});

test('a submitted No does not disclose either person’s contact details',async()=>{
 const f=await fixture();await f.publish(f.snapshot());await f.start();f.tick(DURATION);const links=await f.links(),names=f.rounds[0].matches[0].names,[ta,tb]=names.map(n=>f.token(links.find(p=>p.name===n)));
 await f.api.saveContact(ta,{expectedVersion:0,contacts:{email:'private@example.test'}});await f.api.submit(ta,1,{rating:'smile',stayInTouch:true});await f.api.submit(tb,1,{rating:'smile',stayInTouch:false});
 assert.equal((await f.api.personal(ta)).rounds[0].contacts,null);assert(!JSON.stringify(await f.api.personal(tb)).includes('private@example.test'));
});

test('all twelve round cards accumulate only after completion, including the final round',async()=>{
 const f=await fixture();await f.publish(f.snapshot());const t=f.token((await f.links())[0]);
 for(let round=1;round<=12;round++){assert.equal((await f.api.personal(t)).rounds.length,round-1);await f.start();f.tick(DURATION);assert.equal((await f.api.personal(t)).rounds.length,round);if(round<12)await f.publish(f.snapshot(round+1));}
 await f.publish({...f.state,status:'finished'});assert.equal((await f.api.personal(t)).rounds.length,12);
});

test('rehearsal reset closes test links and clears test data while preserving real links and contacts',async()=>{
 const f=await fixture();await f.api.syncRoster(f.state,f.roster);const real=f.token((await f.links())[0]);await f.api.saveContact(real,{expectedVersion:0,contacts:{email:'real@example.test'}});
 await f.publish(f.snapshot(1,true));const rehearsal=f.token((await f.links('test'))[0]);assert.notEqual(real,rehearsal);await f.api.saveContact(rehearsal,{expectedVersion:0,contacts:{email:'test@example.test'}});
 assert.equal((await f.api.personal(real)).rounds.length,0);await f.publish(waitingState(),{resetTest:true});await assert.rejects(f.api.personal(rehearsal),/closed/);assert.equal((await f.api.personal(real)).profile.contacts.email,'real@example.test');
 await f.api.access(false);await assert.rejects(f.api.personal(real),/closed/);assert.deepEqual((await f.api.feedback(f.state)).responses,[]);await f.api.access(true);assert.equal((await f.api.personal(real)).profile.contacts.email,'real@example.test');
});

test('host capabilities expire and cannot be used as participant links',async()=>{
 const f=await fixture();await assert.rejects(f.api.personal(f.host),/invalid/);f.tick(12*3600000+1);await assert.rejects(f.api.verifyHost(f.host),/host display/);
});

const reserveRows=()=>[1,2,3].map(n=>({id:`qr-person-${n}`,name:`Person ${n}`,qrSlot:n,qrPending:true}));
test('three reserved cards have stable codes, safe waiting pages, and cannot submit before assignment',async()=>{
 const f=await fixture(),reservations=reserveRows();const first=await f.api.syncReservations({rosterVersion:1,reservations});assert.equal(first.reservePages.length,3);assert.deepEqual(await f.api.syncReservations({rosterVersion:1,reservations}),first);
 for(const p of first.reservePages){const token=f.token(p),page=await f.api.personal(token);assert.equal(page.name,`Person ${p.slot}`);assert.equal(page.reservationPending,true);assert.deepEqual(page.rounds,[]);await assert.rejects(f.api.saveContact(token,{expectedVersion:0,contacts:{email:'example@example.test'}}),e=>e.status===403);await assert.rejects(f.api.submit(token,1,{rating:'smile',stayInTouch:false}),e=>e.status===403);}
});
test('a reserved code becomes the new attendee’s profile without changing its URL or consuming a match slot',async()=>{
 const f=await fixture(),reservations=reserveRows(),before=await f.api.syncReservations({rosterVersion:1,reservations}),token=f.token(before.reservePages[0]);reservations[0]={...reservations[0],name:'New Synthetic Attendee',qrPending:false};
 const after=await f.api.syncReservations({rosterVersion:2,reservations});assert.equal(after.reservePages[0].url,before.reservePages[0].url);assert.equal((await f.api.personal(token)).name,'New Synthetic Attendee');
 await f.api.saveContact(token,{expectedVersion:0,contacts:{email:'new-attendee@example.test'}});await f.api.syncRoster(f.state,f.roster);assert.equal((await f.links()).length,14);assert.equal((await f.api.personal(token)).profile.contacts.email,'new-attendee@example.test');assert.deepEqual((await f.api.personal(token)).rounds,[]);
 await assert.rejects(f.api.syncReservations({rosterVersion:1,reservations:reserveRows()}),e=>e.status===409);await assert.rejects(f.api.syncReservations({rosterVersion:3,reservations:reserveRows()}),/cannot be reused/);
 await f.api.access(false);await assert.rejects(f.api.personal(token),e=>e.status===410);await assert.rejects(f.api.personal(f.token(before.reservePages[1])),e=>e.status===410);await f.api.access(true);assert.equal((await f.api.personal(token)).profile.contacts.email,'new-attendee@example.test');
});
test('assigned cards use their participant identity for completed rounds and final feedback',async()=>{
 const f=await fixture(),reservations=reserveRows();f.roster[0].id='qr-person-1';reservations[0]={...reservations[0],name:f.roster[0].name,qrPending:false};const cards=await f.api.syncReservations({rosterVersion:1,reservations}),token=f.token(cards.reservePages[0]);
 await f.publish(f.snapshot());assert.deepEqual((await f.api.personal(token)).rounds,[]);await f.start();f.tick(DURATION);const page=await f.api.personal(token);assert.equal(page.rounds.length,1);assert.equal(page.qrSlot,1);await f.api.submit(token,1,{rating:'neutral',stayInTouch:false});assert.equal((await f.api.feedback(f.state)).responses[0].name,f.roster[0].name);
 await assert.rejects(f.api.syncReservations({rosterVersion:2,reservations:reservations.map((a,i)=>i? a:{...a,name:'A Different Person'})}),/Started participant identities/);
 assert.equal((await f.api.reservations()).reservePages[0].url,cards.reservePages[0].url);
});
test('rehearsals and resets preserve reserved real-event cards and their contact details',async()=>{
 const f=await fixture(),reservations=reserveRows();reservations[0]={...reservations[0],name:'Future Synthetic Person',qrPending:false};const cards=await f.api.syncReservations({rosterVersion:1,reservations}),token=f.token(cards.reservePages[0]);await f.api.saveContact(token,{expectedVersion:0,contacts:{email:'reserved@example.test'}});
 await f.publish(f.snapshot(1,true));assert.equal((await f.api.personal(token)).isTest,false);await f.publish(waitingState(),{resetTest:true});assert.deepEqual(await f.api.reservations(),cards);assert.equal((await f.api.personal(token)).profile.contacts.email,'reserved@example.test');
 await assert.rejects(f.api.syncReservations({rosterVersion:1,reservations:reservations.map((a,i)=>i?a:{...a,name:'Changed same version'})}),/without a new roster version/);
});
test('a spare card aliases an existing attendee and shares the same contacts, matches, and feedback',async()=>{
 const f=await fixture();await f.api.syncRoster(f.state,f.roster);
 const links=await f.links(),normal=f.token(links.find(a=>a.id===f.roster[0].id));
 await f.api.saveContact(normal,{expectedVersion:0,contacts:{email:'existing@example.test'}});
 const originalLinks=await f.links();
 const reservations=reserveRows(),before=await f.api.syncReservations({rosterVersion:1,reservations}),spare=f.token(before.reservePages[0]);
 reservations[0]={...reservations[0],participantId:f.roster[0].id,name:f.roster[0].name,qrPending:false};
 const after=await f.api.syncReservations({rosterVersion:2,reservations});
 assert.equal(after.reservePages[0].url,before.reservePages[0].url);assert.equal(after.reservePages[0].id,f.roster[0].id);
 assert.deepEqual(await f.links(),originalLinks);assert.equal((await f.api.personal(spare)).profile.contacts.email,'existing@example.test');
 await f.api.saveContact(spare,{expectedVersion:1,contacts:{email:'shared@example.test'}});
 assert.equal((await f.api.personal(normal)).profile.contacts.email,'shared@example.test');
 await f.publish(f.snapshot());await f.start();f.tick(DURATION);
 assert.deepEqual((await f.api.personal(spare)).rounds,(await f.api.personal(normal)).rounds);
 await f.api.submit(spare,1,{rating:'smile',stayInTouch:false});
 assert.equal((await f.api.personal(normal)).rounds[0].response.rating,'smile');
 await assert.rejects(f.api.submit(normal,1,{rating:'frown',stayInTouch:false}),/final/);
 await assert.rejects(f.api.syncReservations({rosterVersion:3,reservations:reservations.map((a,i)=>i?a:{...a,participantId:f.roster[1].id,name:f.roster[1].name})}),/cannot be reused/);
 await assert.rejects(f.api.syncReservations({rosterVersion:1,reservations:reserveRows()}),e=>e.status===409);
 assert.equal((await f.api.reservations()).reservePages[0].url,before.reservePages[0].url);
 await f.api.access(false);await assert.rejects(f.api.personal(spare),e=>e.status===410);
});
test('an existing nonparticipant can claim a spare before being included, and claimed cards cannot transfer',async()=>{
 const f=await fixture(),reservations=reserveRows();const before=await f.api.syncReservations({rosterVersion:1,reservations});
 reservations[0]={...reservations[0],participantId:'existing-unchecked',name:'Existing Unchecked Person',qrPending:false};
 const after=await f.api.syncReservations({rosterVersion:2,reservations}),spare=f.token(after.reservePages[0]);
 assert.equal(after.reservePages[0].url,before.reservePages[0].url);assert.equal((await f.api.personal(spare)).name,'Existing Unchecked Person');assert.deepEqual((await f.api.personal(spare)).rounds,[]);
 await f.api.saveContact(spare,{expectedVersion:0,contacts:{email:'unchecked@example.test'}});
 await f.api.syncRoster(f.state,f.roster);assert.equal((await f.links()).length,14);assert.equal((await f.api.personal(spare)).profile.contacts.email,'unchecked@example.test');
 await assert.rejects(f.api.syncReservations({rosterVersion:3,reservations:reservations.map((a,i)=>i?a:{...a,participantId:f.roster[0].id,name:f.roster[0].name})}),/cannot be reused/);
 await assert.rejects(f.api.syncReservations({rosterVersion:3,reservations:reservations.map((a,i)=>i===1?{...a,participantId:'existing-unchecked',name:'Another Person',qrPending:false}:a)}),/Invalid reserved/);
 await assert.rejects(f.api.syncReservations({rosterVersion:3,reservations:reservations.map((a,i)=>i===1?{...a,participantId:'qr-person-3',name:'Another Person',qrPending:false}:a)}),/Invalid reserved/);
});
test('a real event can restart before its first timer starts while keeping contacts and printed codes',async()=>{
 const f=await fixture();await f.api.syncRoster(f.state,f.roster);const links=await f.links(),token=f.token(links[0]);
 await f.api.saveContact(token,{expectedVersion:0,contacts:{email:'kept@example.test'}});const before=await f.links();
 const reservations=reserveRows();reservations[0]={...reservations[0],participantId:f.roster[0].id,name:f.roster[0].name,qrPending:false};const cards=await f.api.syncReservations({rosterVersion:1,reservations});
 await f.publish(f.snapshot());const oldAttempt=f.state.attemptId;
 await f.publish(waitingState(),{resetReal:true});
 assert.equal(f.state.status,'waiting');assert.equal(f.state.currentRound,0);assert.notEqual(f.state.attemptId,oldAttempt);
 assert.equal((await f.api.publicInfo(f.state)).timer,null);assert.deepEqual(await f.links(),before);assert.deepEqual(await f.api.reservations(),cards);
 assert.equal((await f.api.personal(token)).profile.contacts.email,'kept@example.test');assert.deepEqual((await f.api.personal(token)).rounds,[]);
 const archives=(await f.api.restartArchives()).restartArchives;assert.equal(archives.length,1);
 const archive=await f.api.restartArchive(archives[0].id);assert.equal(archive.eventState.currentRound,1);assert.deepEqual(archive.responses,[]);assert.deepEqual(archive.timers,[]);assert(!JSON.stringify(archive).includes('kept@example.test'));
 await f.publish(f.snapshot());const timer=(await f.api.publicInfo(f.state)).timer;assert.equal(timer.remainingMs,DURATION);assert.equal(timer.status,'idle');
 await assert.rejects(f.api.timer(f.host,f.state,{runId:activeRun(f.state),round:1,expectedVersion:0}),/event restarted/);
 await assert.rejects(f.api.preparePublish(f.state,f.snapshot(2),{operationId:'too-early',participantRoster:f.roster}),/full five-minute/);
 await f.start();f.tick(DURATION);assert.equal((await f.api.publicInfo(f.state)).completedThroughRound,1);
});
test('restart archives final responses, clears active exchanges and timers, and rejects stale submissions',async()=>{
 const f=await fixture();await f.publish(f.snapshot());await f.start();f.tick(DURATION);
 const names=f.rounds[0].matches[0].names,links=await f.links(),[a,b]=names.map(name=>f.token(links.find(l=>l.name===name))),oldAttempt=f.state.attemptId;
 await f.api.saveContact(a,{expectedVersion:0,contacts:{email:'a@example.test'}});await f.api.saveContact(b,{expectedVersion:0,contacts:{email:'b@example.test'}});
 await f.api.submit(a,1,{rating:'smile',stayInTouch:true,attemptId:oldAttempt});await f.api.submit(b,1,{rating:'frown',stayInTouch:true,attemptId:oldAttempt});assert.equal((await f.api.personal(a)).rounds[0].mutual,true);
 await f.publish(f.snapshot(2));await f.start();f.tick(30000);await f.publish({...f.state,status:'break'});
 await f.publish(waitingState(),{resetReal:true});
 assert.deepEqual((await f.api.feedback(f.state)).responses,[]);assert.equal((await f.api.personal(a)).profile.contacts.email,'a@example.test');assert.deepEqual((await f.api.personal(a)).rounds,[]);
 const archives=(await f.api.restartArchives()).restartArchives,archive=await f.api.restartArchive(archives[0].id);
 assert.equal(archive.responses.length,2);assert.equal(archive.timers.length,2);assert.equal(archive.eventState.status,'break');assert.equal(archive.eventState.currentRound,2);
 assert.equal(archive.responses[0].rating,'smile');assert.equal(archive.responses[1].rating,'frown');assert(!JSON.stringify(archive).includes('nonce'));
 await f.publish(f.snapshot());await f.start();f.tick(DURATION);
 const fresh=await f.api.personal(a);assert.equal(fresh.rounds[0].response,null);assert.equal(fresh.rounds[0].mutual,false);assert.notEqual(fresh.attemptId,oldAttempt);
 await assert.rejects(f.api.submit(a,1,{rating:'smile',stayInTouch:true,attemptId:oldAttempt}),/event restarted/);
 await assert.rejects(f.api.submit(a,1,{rating:'smile',stayInTouch:true}),/event restarted/);
 await f.api.submit(a,1,{rating:'neutral',stayInTouch:false,attemptId:fresh.attemptId});assert.equal((await f.api.personal(a)).rounds[0].response.rating,'neutral');
 await f.publish(waitingState(),{resetReal:true});assert.equal((await f.api.restartArchives()).restartArchives.length,2);
 assert.equal((await f.api.restartArchive(archives[0].id)).responses.length,2);
});
test('a completed real event can restart, while reset mode and destination checks stay strict',async()=>{
 const f=await fixture();await f.publish(f.snapshot());
 for(let round=1;round<=12;round++){await f.start();f.tick(DURATION);if(round<12)await f.publish(f.snapshot(round+1));}
 await f.publish({...f.state,status:'finished'});await f.publish(waitingState(),{resetReal:true});assert.equal(f.state.status,'waiting');
 const archive=await f.api.restartArchive((await f.api.restartArchives()).restartArchives[0].id);assert.equal(archive.eventState.status,'finished');assert.equal(archive.timers.length,12);
 await assert.rejects(f.api.restartArchive('../event'),/Choose an archived/);await assert.rejects(f.api.restartArchive('real-archive-missing'),e=>e.status===404);
 assert.throws(()=>validateTransition(waitingState(),waitingState(),{resetReal:true}),/started real/);
 assert.throws(()=>validateTransition({...f.snapshot(),isTest:true},waitingState(),{resetReal:true}),/started real/);
 assert.throws(()=>validateTransition(f.snapshot(),waitingState(),{resetReal:true,resetTest:true}),/started real/);
 assert.throws(()=>validateTransition(f.snapshot(),f.snapshot(),{resetReal:true}),/return the display/);
 await f.publish(f.snapshot());assert.equal((await f.api.publicInfo(f.state)).timer.remainingMs,DURATION);
});
test('a complete protected backup includes persisted profiles, responses, timers and stable codes, without service secrets',async()=>{
 const f=await fixture();await f.publish(f.snapshot());await f.start();f.tick(DURATION);
 const links=await f.links(),token=f.token(links[0]);await f.api.saveContact(token,{expectedVersion:0,contacts:{email:'backup@example.test'}});await f.api.submit(token,1,{rating:'smile',stayInTouch:false});
 const cards=await f.api.syncReservations({rosterVersion:1,reservations:reserveRows()}),before=await f.api.personal(token),backup=await f.api.exportBackup();
 assert.equal(backup.format,'chipma-results-backup-v1');assert.equal(backup.tables.participant_links.length,14);assert.equal(backup.tables.participant_contacts.length,1);assert.equal(backup.tables.conversation_responses.length,1);assert.equal(backup.tables.round_timers.length,1);
 assert.equal(backup.participantUrls.find(p=>p.id===links[0].id).url,links[0].url);assert.deepEqual(backup.reservePages,cards.reservePages);
 assert(!JSON.stringify(backup).includes('synthetic-test-only-key'));assert.equal(JSON.parse(backup.tables.participant_contacts[0].body).email,'backup@example.test');assert.deepEqual(await f.api.personal(token),before);
});
