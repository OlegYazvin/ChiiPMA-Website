import { env } from "cloudflare:workers";
export async function readState(id="event") {
  if(!env.DB) throw Error("Event database unavailable.");
  const row=await env.DB.prepare("SELECT version, body FROM event_state WHERE id = ?").bind(id).first<{version:number,body:string}>();
  return row?{...JSON.parse(row.body),version:row.version}:null;
}
export async function writeState(state:any,expectedVersion:number,id="event") {
  if(!env.DB)throw Error("Event database unavailable.");
  const body=JSON.stringify({...state,version:expectedVersion+1});
  const result=expectedVersion===0?await env.DB.prepare("INSERT OR IGNORE INTO event_state (id,version,body) VALUES (?,1,?)").bind(id,body).run():await env.DB.prepare("UPDATE event_state SET version=version+1,body=? WHERE id=? AND version=?").bind(body,id,expectedVersion).run();
  if(result.meta.changes!==1)throw Object.assign(Error("This event changed in another tab. Refresh and try again."),{status:409});
  return {...state,version:expectedVersion+1};
}
