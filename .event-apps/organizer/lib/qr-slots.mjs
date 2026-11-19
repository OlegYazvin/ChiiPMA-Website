export const QR_SLOTS=[1,2,3];
export const qrSlotId=slot=>`qr-person-${slot}`;
export function qrSlotFields(a){
 const match=/^qr-person-([123])$/.exec(a.id),slot=match?Number(match[1]):null;
 if(!slot){if(a.qrSlot!=null||a.qrPending!=null)throw Error('QR card labels belong to the three reserved identities.');return {};}
 if(a.qrSlot!==slot||typeof a.qrPending!=='boolean')throw Error('Keep the reserved QR card identity and label together.');
 if(a.qrPending&&(a.name!==`Person ${slot}`||a.included!==false))throw Error('Name the reserved card before marking its attendee participating.');
 return {qrSlot:slot,qrPending:a.qrPending};
}
export function reserveQrPeople(roster){
 return [...roster,...QR_SLOTS.filter(slot=>!roster.some(a=>a.id===qrSlotId(slot))).map(slot=>({id:qrSlotId(slot),name:`Person ${slot}`,qrSlot:slot,qrPending:true,isMpdStudent:false,isStudent:false,level:null,jobs:[],employmentStatus:null,currentPeopleLeader:false,included:false}))];
}
export function claimNextQrPerson(roster,attendee,assignedSlots=[]){
 const slot=roster.filter(a=>a.qrPending&&!assignedSlots.includes(a.qrSlot)).sort((a,b)=>a.qrSlot-b.qrSlot)[0];
 if(!slot)return {roster:[...roster,attendee],attendee};
 const person={...attendee,id:slot.id,qrSlot:slot.qrSlot,qrPending:false,included:false};
 return {roster:roster.map(a=>a.id===slot.id?person:a),attendee:person};
}
export function validateQrSlots(previous,next){
 for(const old of previous.filter(a=>a.qrSlot)){
  const current=next.find(a=>a.id===old.id);
  if(!current||current.qrSlot!==old.qrSlot)throw Error('Keep reserved QR rows in the roster; mark them not participating instead of removing them.');
  if(!old.qrPending&&current.qrPending)throw Error('An assigned QR card cannot be reset for a different attendee.');
 }
}
