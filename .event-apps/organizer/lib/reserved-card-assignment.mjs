import {QR_SLOTS,qrSlotId} from './qr-slots.mjs';

export function validateExistingQrAssignments(state){
 const assignments=state.qrAssignments??{},used=new Set();
 if(typeof assignments!=='object'||Array.isArray(assignments))throw Error('Invalid reserved QR assignments.');
 for(const [key,id] of Object.entries(assignments)){
  const slot=Number(key),row=state.roster.find(a=>a.id===qrSlotId(slot)),target=state.roster.find(a=>a.id===id);
  if(!QR_SLOTS.includes(slot)||String(slot)!==key||!row?.qrPending||!target||target.qrSlot||used.has(id))throw Error('Keep each reserved QR card linked to its existing attendee.');
  used.add(id);
 }
 return assignments;
}

export function assignExistingQrCard(state,slot,attendeeId){
 if(state.pending)throw Object.assign(Error('Finish the pending round release before assigning a QR card.'),{status:409});
 const assignments=validateExistingQrAssignments(state),row=state.roster.find(a=>a.qrSlot===slot);
 if(!QR_SLOTS.includes(slot)||!row?.qrPending||assignments[slot])throw Error('Choose an unassigned reserved QR card.');
 const target=state.roster.find(a=>a.id===attendeeId);
 if(!target||target.qrSlot)throw Error('Choose an existing attendee from the roster.');
 if(Object.values(assignments).includes(attendeeId))throw Error('This attendee already has a reserved QR card.');
 return {...state,qrAssignments:{...assignments,[slot]:attendeeId}};
}

export function reservedCardRows(state){
 const assignments=validateExistingQrAssignments(state);
 return state.roster.filter(a=>a.qrSlot).map(a=>{
  const target=state.roster.find(person=>person.id===assignments[a.qrSlot]);
  return {id:a.id,name:target?.name??a.name,qrSlot:a.qrSlot,qrPending:target?false:a.qrPending,...target?{participantId:target.id}:{}};
 });
}
