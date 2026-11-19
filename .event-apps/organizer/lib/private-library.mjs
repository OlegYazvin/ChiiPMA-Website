export const MAX_FILE_BYTES=16*1024*1024;
const PREFIX='private-library/v1/';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
function storage(bucket){if(!bucket)fail('Private file storage is unavailable.',503);return bucket;}
export function validateFilePath(path){
 if(typeof path!=='string'||!path||path.length>500||/[\\\u0000-\u001f\u007f]/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'))fail('Use a relative file path without empty or parent-directory segments.');
 return path;
}
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
function keyForId(id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('Choose a saved private file.');return PREFIX+id;}
function metadata(object){return {id:object.key.slice(PREFIX.length),path:object.customMetadata.path,size:object.size,sha256:object.customMetadata.sha256,uploadedAt:object.uploaded.toISOString(),etag:object.httpEtag,downloadUrl:'/api/library/download?id='+object.key.slice(PREFIX.length)};}
export async function listPrivateFiles(bucket,cursor){
 storage(bucket);const page=await bucket.list({prefix:PREFIX,limit:100,cursor:cursor||undefined}),files=[];
 for(const object of page.objects){const head=await bucket.head(object.key);if(head)files.push(metadata(head));}
 return {files,cursor:page.truncated?page.cursor:null};
}
export async function uploadPrivateFile(bucket,request){
 storage(bucket);
 const rawLength=request.headers.get('content-length');if(rawLength===null)fail('A known file size is required.',411);
 const size=Number(rawLength);if(!Number.isSafeInteger(size)||size<0||size>MAX_FILE_BYTES)fail('Keep each private file at or below 16 MB.',413);
 // Bounded buffering consumes the request before any idempotent/validation
 // response. This also makes interrupted retries safe through HTTP proxies.
 const bytes=await request.arrayBuffer();if(bytes.byteLength!==size)fail('The uploaded file size changed. Retry the upload.');
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)fail('Cross-origin write rejected.',403);
 let path;try{path=decodeURIComponent(request.headers.get('x-file-path')||'');}catch{fail('Invalid private file path.');}validateFilePath(path);
 const sha256=request.headers.get('x-file-sha256')||'';if(!/^[a-f0-9]{64}$/.test(sha256))fail('Supply the SHA-256 checksum for this file.');
 const key=PREFIX+await digest(path),existing=await bucket.head(key);
 if(existing?.customMetadata.sha256===sha256&&existing.size===size)return {file:metadata(existing),unchanged:true};
 if(existing&&request.headers.get('if-match')!==existing.httpEtag)fail('This file already exists. Refresh the file list before replacing it.',409);
 if(!existing&&request.headers.has('if-match'))fail('The file changed. Refresh and retry.',409);
 let saved;try{saved=await bucket.put(key,bytes,{sha256:Uint8Array.from(sha256.match(/../g),v=>parseInt(v,16)),onlyIf:existing?{etagMatches:existing.etag}:{etagDoesNotMatch:'*'},customMetadata:{path,sha256},httpMetadata:{contentType:'application/octet-stream'}});}catch{fail('The file could not be saved or its checksum did not match. Retry the upload.',422);}
 if(!saved)fail('The file changed in another tab. Refresh and retry.',409);
 return {file:metadata(saved),unchanged:false};
}
export async function downloadPrivateFile(bucket,id){
 storage(bucket);const file=await bucket.get(keyForId(id));if(!file)fail('Private file not found.',404);
 const name=file.customMetadata.path.split('/').at(-1);
 return new Response(file.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(file.size),'Content-Disposition':`attachment; filename="chipma-private-file"; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox','X-Content-SHA256':file.customMetadata.sha256}});
}
