const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const face={frown:'☹️',neutral:'😐',smile:'🙂'};
export function mountParticipantAdmin({getState,api,notice,canAssign=()=>true,onAssigned=()=>{},onAssignBusyChange=()=>{}}){
 let data={participants:[],reservePages:[],responses:[],accessOpen:true},busy=false;
 const mode=()=>$('#personal-mode').value;
 function qr(url){const code=globalThis.qrcode(0,'M');code.addData(url);code.make();return code.createSvgTag({cellSize:4,margin:16,scalable:true});}
 function card(p,reserved=false){const key=reserved?'reserved:'+p.slot:p.id,title=reserved?'Person '+p.slot:p.name;
  const state=getState(),assigned=new Set(Object.values(state?.qrAssignments||{})),eligible=(state?.roster||[]).filter(a=>!a.qrSlot&&!assigned.has(a.id)).sort((a,b)=>a.name.localeCompare(b.name));
  const disabled=busy||!!state?.pending||!canAssign();
  const assignment=reserved&&p.pending?`<form class="reserve-assignment" data-assign-slot="${p.slot}"><label>Assign existing attendee<select name="attendeeId" aria-label="Attendee for Person ${p.slot}" required${disabled?' disabled':''}><option value="">Choose an attendee</option>${eligible.map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label><button class="button primary" type="submit"${disabled||!eligible.length?' disabled':''}>Assign existing attendee</button><small>${!canAssign()?'Save roster edits before assigning a card.':'The printed code stays the same. Assignments cannot be transferred to another person.'}</small></form>`:'';
  return `<article class="personal-card${reserved?' reserved-qr-card':''}"><h3>${esc(title)}</h3><div class="personal-qr">${qr(p.url)}</div><p>${reserved?(p.pending?'Unassigned · available for an existing or new attendee':'Assigned to '+esc(p.name)):(p.contactReady?'Contact details saved':'Contact details not yet saved')}</p>${assignment}<div class="actions"><a class="button secondary" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open page</a><button class="button secondary" data-copy="${esc(key)}">Copy link</button><button class="button secondary" data-qr="${esc(key)}">Download QR</button></div></article>`;}
 function render(){
  $('#personal-summary').textContent=`${data.participants.length} personal pages · ${(data.reservePages||[]).length} reserved QR cards · ${data.participants.filter(p=>p.contactReady).length} contact profiles saved · ${data.responses.length} final responses${mode()==='test'?' · REHEARSAL DATA':''}`;
  $('#personal-cards').innerHTML=data.participants.map(p=>card(p)).join('');
  $('#reserve-pages-section').hidden=!(data.reservePages||[]).length;$('#reserved-personal-cards').innerHTML=(data.reservePages||[]).map(p=>card(p,true)).join('');$('#print-reserve-pages').disabled=busy||!(data.reservePages||[]).length;
  $('#feedback-rows').innerHTML=data.responses.map(r=>`<tr><td>${r.round}</td><td>${esc(r.name)}</td><td>${esc(r.partner)}</td><td>${face[r.rating]} ${esc(r.rating)}</td><td>${esc(new Date(r.submittedAt).toLocaleString())}</td></tr>`).join('');
  $('#restart-archives').innerHTML=(data.restartArchives||[]).map(a=>`<p>${esc(new Date(a.archivedAt).toLocaleString())} · ${a.roundsReleased} rounds released · ${a.responses} responses <button class="button secondary" data-archive="${esc(a.id)}">Download previous attempt</button></p>`).join('')||'<p class="muted">No previous real-event attempts.</p>';
  $('#participant-access').textContent=data.accessOpen?'Close participant pages':'Reopen participant pages';
  $('#participant-access').disabled=busy||mode()==='test';$('#print-personal-pages').disabled=busy||!data.participants.length;$('#export-feedback').disabled=busy||!data.responses.length;$('#sync-personal-pages').disabled=busy;$('#open-host-display').disabled=busy;
 }
 async function refresh(){try{const next=await api('participant-admin?mode='+mode());data=next;render();}catch(e){notice(e.message,true);}}
 async function action(body){return api('participant-admin',{expectedVersion:getState().version,...body});}
 $('#personal-mode').onchange=refresh;$('#refresh-personal-pages').onclick=refresh;
 $('#sync-personal-pages').onclick=async()=>{busy=true;render();try{await action({action:'sync',mode:mode()});await refresh();notice('Personal QR links are ready. Existing participant links stay the same.');}catch(e){notice(e.message,true);}finally{busy=false;render();}};
 $('#open-host-display').onclick=()=>window.open('https://www.chipma.org/speed-networking-event/?display=1','_blank','noopener,noreferrer');
 $('#participant-access').onclick=async()=>{if(data.accessOpen&&!window.confirm('Close all participant pages? Participants will no longer be able to view contacts or submit responses until you reopen access.'))return;busy=true;render();try{await action({action:'access',open:!data.accessOpen});await refresh();}catch(e){notice(e.message,true);}finally{busy=false;render();}};
 async function cardAction(e){const copy=e.target.closest('[data-copy]'),download=e.target.closest('[data-qr]'),key=copy?.dataset.copy||download?.dataset.qr;const p=String(key).startsWith('reserved:')?(data.reservePages||[]).find(p=>'reserved:'+p.slot===key):data.participants.find(p=>p.id===key);if(!p)return;
  if(copy){try{await navigator.clipboard.writeText(p.url);notice(`Copied ${p.name}'s personal link.`);}catch{notice('Open the personal page and copy its full URL, including the code after #.',true);}}
  if(download)save((p.slot?'Person '+p.slot:p.name).replace(/[^a-z0-9]+/gi,'-')+'-QR.svg','image/svg+xml',qr(p.url));
 }
 $('#personal-cards').onclick=cardAction;$('#reserved-personal-cards').onclick=cardAction;
 $('#restart-archives').onclick=async e=>{const button=e.target.closest('[data-archive]');if(!button)return;button.disabled=true;try{const archive=await api('restart-archive?id='+encodeURIComponent(button.dataset.archive));save('chipma-event-before-restart-'+archive.archivedAt.replace(/[^a-z0-9]+/gi,'-')+'.json','application/json',JSON.stringify(archive,null,2));}catch(error){notice(error.message,true);}finally{button.disabled=false;}};
 $('#reserved-personal-cards').onsubmit=async e=>{
  const form=e.target.closest('[data-assign-slot]');if(!form)return;e.preventDefault();
  if(busy||getState()?.pending||!canAssign())return;
  const slot=Number(form.dataset.assignSlot),attendeeId=form.elements.attendeeId.value;
  if(!attendeeId){notice('Choose an attendee for this QR card.',true);return;}
  busy=true;onAssignBusyChange(true);render();
  try{const next=await api('qr-assignment',{expectedVersion:getState().version,slot,attendeeId});onAssigned(next);await refresh();notice(next.qrSyncWarning||`Person ${slot} is assigned to ${next.roster.find(a=>a.id===attendeeId)?.name}. Hand them the Person ${slot} card. Participation is unchanged.`);}
  catch(error){notice(error.message,true);}finally{busy=false;onAssignBusyChange(false);render();}
 };
 function save(name,type,content){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function printCards(rows){const tab=window.open('about:blank','_blank');if(!tab){notice('Allow the print popup and try again.',true);return;}tab.opener=null;
  tab.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>ChiPMA private QR cards</title><style>@page{size:letter;margin:.4in}body{font:14px system-ui;margin:0}.cards{display:grid;grid-template-columns:1fr 1fr;gap:.16in}.card{border:1px solid #aaa;padding:.18in;text-align:center;break-inside:avoid}.card h2{font-size:18px;margin:0 0 8px}.qr{width:1.65in;margin:8px auto}.qr svg{display:block;width:100%;height:auto}p{font-size:11px;margin:6px 0}.url{overflow-wrap:anywhere;font-size:8px}</style></head><body><div class="cards">${rows.map(p=>`<section class="card"><h2>${esc(p.name)}</h2><p>ChiPMA speed networking${mode()==='test'?' · TEST RUN':''}</p><div class="qr">${qr(p.url)}</div><p>Scan for your contact details and conversation feedback.</p><p>Save your full link to return later. Keep this card private.</p><p class="url">${esc(p.url)}</p></section>`).join('')}</div></body></html>`);tab.document.close();tab.focus();tab.print();
 }
 $('#print-personal-pages').onclick=()=>printCards(data.participants);
 $('#print-reserve-pages').onclick=()=>printCards((data.reservePages||[]).map(p=>({...p,name:'Person '+p.slot})));
 $('#export-feedback').onclick=()=>{const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';save('chipma-conversation-ratings.csv','text/csv;charset=utf-8','\ufeff'+[['Round','Participant','Partner','Rating','Submitted at'],...data.responses.map(r=>[r.round,r.name,r.partner,r.rating,r.submittedAt])].map(row=>row.map(quote).join(',')).join('\r\n'));};
 return {refresh,render};
}
