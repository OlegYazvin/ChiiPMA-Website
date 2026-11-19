const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountFileLibrary({api,notice}){
 let files=[],busy=false;
 function render(){
  $('#library-summary').textContent=`${files.length} private files saved in the admin app. Available when you sign in on another device.`;
  $('#library-files').innerHTML=files.sort((a,b)=>a.path.localeCompare(b.path)).map(f=>`<tr><td>${esc(f.path)}</td><td>${Math.max(1,Math.ceil(f.size/1024)).toLocaleString()} KB</td><td>${esc(new Date(f.uploadedAt).toLocaleString())}</td><td><a class="button secondary" href="${esc(f.downloadUrl)}" download>Download</a></td></tr>`).join('')||'<tr><td colspan="4">No private files uploaded yet.</td></tr>';
  for(const id of ['#library-upload','#library-input','#library-folder','#download-event-backup','#refresh-library'])$(id).disabled=busy;
 }
 async function refresh(){try{let cursor=null,next=[];do{const page=await api('library'+(cursor?'?cursor='+encodeURIComponent(cursor):''));next.push(...page.files);cursor=page.cursor;}while(cursor);files=next;render();}catch(error){notice(error.message,true);}}
 $('#refresh-library').onclick=refresh;
 $('#library-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;const selected=[...$('#library-input').files];if(!selected.length)return;
  const folder=$('#library-folder').value.trim().replace(/\/$/,'');busy=true;render();let count=0;
  try{for(const file of selected){
   if(file.size>16*1024*1024)throw Error('Keep each private file at or below 16 MB.');
   $('#library-status').textContent=`Uploading ${++count} of ${selected.length}: ${file.name}`;
   const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer()),sha256=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
   const path=(folder?folder+'/':'')+file.name,previous=files.find(f=>f.path===path);
   const response=await fetch('/api/library/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Path':encodeURIComponent(path),'X-File-SHA256':sha256,...previous?{'If-Match':previous.etag}:{}},body:file});
   let result;try{result=await response.json();}catch{throw Error('The upload connection was interrupted. Refresh the file list and retry; completed uploads are kept.');}if(!response.ok)throw Error(result.error||'Private file upload failed.');
  }$('#library-input').value='';await refresh();notice(`${selected.length} private files saved to the admin app.`);
  }catch(error){notice(error.message,true);}finally{busy=false;$('#library-status').textContent='';render();}
 };
 $('#download-event-backup').onclick=async()=>{
  if(busy)return;busy=true;render();try{const data=await api('event-backup'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='ChiPMA-current-event-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Current event backup downloaded. Keep this file private.');}catch(error){notice(error.message,true);}finally{busy=false;render();}
 };
 return {refresh};
}
