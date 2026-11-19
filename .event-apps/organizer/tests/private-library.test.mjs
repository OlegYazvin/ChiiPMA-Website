import test from 'node:test';
import assert from 'node:assert/strict';
import {listPrivateFiles,uploadPrivateFile,downloadPrivateFile,validateFilePath,MAX_FILE_BYTES} from '../lib/private-library.mjs';
const hex=data=>crypto.subtle.digest('SHA-256',data).then(x=>Buffer.from(x).toString('hex'));
class Bucket{
 objects=new Map();
 async head(key){const item=this.objects.get(key);return item?{...item}:null;}
 async list(){return {objects:[...this.objects.values()],truncated:false};}
 async get(key){const value=this.objects.get(key);return value?{...value,body:new Blob([value.bytes]).stream()}:null;}
 async put(key,body,options){
  const old=this.objects.get(key);if(options.onlyIf.etagDoesNotMatch==='*'&&old||old&&options.onlyIf.etagMatches!==old.etag)return null;
  const bytes=new Uint8Array(await new Response(body).arrayBuffer()),sha=await hex(bytes);if(sha!==Buffer.from(options.sha256).toString('hex'))throw Error('Checksum');
  const object={key,bytes,size:bytes.length,etag:sha,httpEtag:'"'+sha+'"',customMetadata:options.customMetadata,uploaded:new Date('2026-11-19T00:00:00Z')};this.objects.set(key,object);return object;
 }
}
async function request(path,bytes,extra={}){return new Request('https://admin.example/api/library/upload',{method:'POST',headers:{'X-File-Path':encodeURIComponent(path),'X-File-SHA256':await hex(bytes),'Content-Length':String(bytes.length),...extra},body:bytes});}
test('private binary documents retain their checksum and download as attachments',async()=>{
 const bucket=new Bucket(),bytes=new Uint8Array([0,255,42,10,90]),saved=await uploadPrivateFile(bucket,await request('prints/Synthetic QR cards.pdf',bytes));
 const listed=await listPrivateFiles(bucket);assert.equal(listed.files.length,1);assert.equal(listed.files[0].sha256,await hex(bytes));assert.equal(listed.files[0].path,'prints/Synthetic QR cards.pdf');
 const response=await downloadPrivateFile(bucket,saved.file.id);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.match(response.headers.get('Content-Disposition'),/^attachment;/);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Content-Security-Policy'),'sandbox');
 assert.equal((await uploadPrivateFile(bucket,await request('prints/Synthetic QR cards.pdf',bytes))).unchanged,true);
});
test('replacements require the current file version and checksum verification',async()=>{
 const bucket=new Bucket(),old=new TextEncoder().encode('old'),next=new TextEncoder().encode('new'),saved=await uploadPrivateFile(bucket,await request('research/synthetic.json',old));
 await assert.rejects(uploadPrivateFile(bucket,await request('research/synthetic.json',next)),e=>e.status===409);
 await assert.rejects(uploadPrivateFile(bucket,await request('research/synthetic.json',next,{'If-Match':saved.file.etag,'X-File-SHA256':'0'.repeat(64)})),e=>e.status===422);
 const replaced=await uploadPrivateFile(bucket,await request('research/synthetic.json',next,{'If-Match':saved.file.etag}));assert.equal(replaced.file.id,saved.file.id);assert.equal(replaced.file.sha256,await hex(next));
});
test('missing storage, invalid paths, oversized uploads and unknown file IDs fail safely',async()=>{
 for(const path of ['../private','/absolute','a//b','a/../b','a\\b','a\nb',''])assert.throws(()=>validateFilePath(path));
 const bytes=new Uint8Array([1]),bucket=new Bucket();
 await assert.rejects(uploadPrivateFile(null,await request('ok.txt',bytes)),e=>e.status===503);
 await assert.rejects(uploadPrivateFile(bucket,await request('ok.txt',bytes,{'Content-Length':String(MAX_FILE_BYTES+1)})),e=>e.status===413);
 await assert.rejects(downloadPrivateFile(bucket,'../../event'),e=>e.status===400);
 await assert.rejects(downloadPrivateFile(bucket,'0'.repeat(64)),e=>e.status===404);
});
