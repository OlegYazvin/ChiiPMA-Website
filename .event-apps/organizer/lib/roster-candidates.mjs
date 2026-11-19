import {normalizeRoster,participants,validateSchedule} from './matching.mjs';
import {claimNextQrPerson} from './qr-slots.mjs';
import {validateExistingQrAssignments} from './reserved-card-assignment.mjs';

export function addNonparticipant(state,attendee){
 if(state.pending)throw Object.assign(Error('Finish the pending round release before adding a nonparticipant.'),{status:409});
 if(!attendee||typeof attendee!=='object'||Array.isArray(attendee))throw Error('Supply one attendee to add as not participating.');
 if(state.roster.some(a=>a.id===attendee.id||a.name.toLocaleLowerCase()===String(attendee.name).trim().toLocaleLowerCase()))throw Error('Each attendee needs a unique ID and unique display name.');
 const assignments=validateExistingQrAssignments(state),claimed=claimNextQrPerson(state.roster,{...attendee,included:false},Object.keys(assignments).map(Number)),roster=normalizeRoster(claimed.roster);
 const unchanged=state.roster.filter(a=>a.id!==claimed.attendee.id);
 if(JSON.stringify(roster.filter(a=>unchanged.some(old=>old.id===a.id)))!==JSON.stringify(unchanged))throw Error('Adding a nonparticipant cannot change existing roster settings.');
 if(JSON.stringify(participants(roster).map(a=>a.id))!==JSON.stringify(participants(state.roster).map(a=>a.id)))throw Error('Adding a nonparticipant cannot change the match pool.');
 if(state.schedule)validateSchedule(roster,state.schedule);
 return {...state,roster};
}
