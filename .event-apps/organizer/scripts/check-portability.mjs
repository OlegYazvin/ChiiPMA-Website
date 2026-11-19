// Synthetic LOCAL check. Uses isolated .wrangler/portability-e2e stores.
import assert from 'node:assert/strict';
import {normalizeRoster,generateFast} from '../lib/matching.mjs';
const admin='http://127.0.0.1:8797',results='http://127.0.0.1:8798';
async function api(base,path,body,token){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...body?{'Content-Type':'application/json'}:{},...token?{Authorization:'Bearer '+token}:{}},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
const digest=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
async function upload(path,bytes,extra={}){const response=await fetch(admin+'/api/library/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Path':encodeURIComponent(path),'X-File-SHA256':await digest(bytes),...extra},body:bytes});return {status:response.status,data:await response.json()};}
assert.equal((await api(admin,'state')).data.version,0,'Fresh LOCAL storage is required.');
const bytes=new Uint8Array(2*1024*1024+19);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
const initial=(await api(admin,'library')).data.files;
assert(initial.length===0||initial.length===1&&initial[0].path==='workspace/Synthetic private workspace.bin'&&initial[0].sha256===await digest(bytes),'Only an identical interrupted-upload retry may already exist.');
let response=await upload('workspace/Synthetic private workspace.bin',bytes);assert.equal(response.status,200,JSON.stringify(response.data));
const file=response.data.file;assert.equal(file.sha256,await digest(bytes));assert.equal(file.size,bytes.length);
const downloaded=await fetch(admin+file.downloadUrl);assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('Content-Disposition'),/^attachment;/);assert.equal(await digest(await downloaded.arrayBuffer()),await digest(bytes));
assert.equal((await upload('workspace/Synthetic private workspace.bin',bytes)).data.unchanged,true);
assert.equal((await upload('workspace/Synthetic private workspace.bin',new Uint8Array([1,2,3]))).status,409);
assert.equal((await upload('../bad.bin',bytes)).status,400);
assert.equal((await upload('workspace/wrong.bin',bytes,{'X-File-SHA256':'0'.repeat(64)})).status,422);
assert.equal((await upload('workspace/cross-origin.bin',bytes,{Origin:'https://untrusted.example'})).status,403);
assert.equal((await api(admin,'library')).data.files.length,1);assert.equal((await api(admin,'state')).data.version,0);
const roster=normalizeRoster(Array.from({length:28},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic Person ${i}`,isMpdStudent:i<14,isStudent:i<14,level:'Senior',jobs:[],employmentStatus:'Employed',included:true})));
let init=await api(admin,'initialize',{roster,schedule:generateFast(roster,17)});assert.equal(init.status,200);let state=init.data;
await api(admin,'participant-admin',{expectedVersion:state.version,action:'sync',mode:'real'});
const pages=(await api(admin,'participant-admin?mode=real')).data,token=pages.participants[0].url.split('#')[1];
assert.equal((await api(results,'participant/contact',{expectedVersion:0,contacts:{email:'private-backup@example.test'}},token)).status,200);
const before=(await api(admin,'state')).data,backup=await api(admin,'event-backup');assert.equal(backup.status,200,JSON.stringify(backup.data));
assert.equal(backup.data.organizer.version,before.version);assert.equal(backup.data.results.tables.participant_contacts.length,1);assert.equal(backup.data.results.participantUrls.length,28);assert.deepEqual((await api(admin,'state')).data,before);
assert.equal((await api(results,'manage/backup')).status,401);assert.equal((await api(results,'manage/backup',null,token)).status,401);
const feed=JSON.stringify((await api(results,'state')).data);for(const value of ['private-backup@example.test','participant_links','private-library'])assert(!feed.includes(value));
console.log('Passed local HTTP flow: >1MB private R2 upload, server-verified checksum, exact download, idempotency, safe replacement/path/origin rejection, cross-device manifest, protected full backup, and unchanged event state.');
