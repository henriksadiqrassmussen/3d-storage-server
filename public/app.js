const logBox = document.getElementById('log');
function log(msg){ const t=new Date().toLocaleTimeString('da-DK'); logBox.textContent += `[${t}] ${msg}\n`; logBox.scrollTop=logBox.scrollHeight; }
function base(){
  let u = document.getElementById('serverUrl').value.trim();
  if(!u) u = location.origin;
  if(u.startsWith('//')) u = 'https:' + u;
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/(health|api\/.*)$/i,'');
  u = u.replace(/\/+$/,'');
  document.getElementById('serverUrl').value = u;
  return u;
}
function email(){ return document.getElementById('email').value.trim().toLowerCase(); }
function normalizeSignedUrl(url){
  let u = String(url || '').trim();
  if(u.startsWith('//')) u = 'https:' + u;
  if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}
function fmt(bytes){
  bytes=Number(bytes||0); const units=['B','KB','MB','GB','TB']; let i=0;
  while(bytes>=1024 && i<units.length-1){bytes/=1024;i++;}
  return `${bytes.toFixed(i?2:0)} ${units[i]}`;
}
async function api(path, opts={}){
  const r = await fetch(base()+path, opts);
  const txt = await r.text();
  let data; try{ data=JSON.parse(txt); }catch{ data={ok:false,error:txt}; }
  if(!r.ok || data.ok===false) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
async function testServer(){
  try{ log('Tester server...'); const d=await api('/health'); document.getElementById('statusPill').textContent=`v${d.version} · ${d.storageDriver}`; log(`OK: v${d.version}, ${d.r2Mode||d.storageDriver}`); }
  catch(e){ log('FEJL server: '+e.message); }
}
async function loadAccount(){
  try{ log('Henter konto: '+email()); const d=await api('/api/me?email='+encodeURIComponent(email())); const u=d.user; document.getElementById('accountBox').textContent = `E-mail: ${u.email}\nPlan: ${u.plan}\nBrugt: ${fmt(u.usedBytes)}\nLedig: ${fmt(u.freeBytes)}\nKvote: ${fmt(u.quotaBytes)}\nPris: 1 GB = 1 euro`; log(`KONTO OK: ${u.email} - ${u.plan}`); }
  catch(e){ log('FEJL konto: '+e.message); }
}
async function uploadFile(){
  const f = document.getElementById('fileInput').files[0];
  if(!f){ log('Vælg en fil først.'); return; }
  try{
    document.getElementById('uploadStatus').textContent='Forbereder upload...';
    log('Forbereder signed upload: '+f.name);
    const prep = await api('/api/upload-url', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:email(), fileName:f.name, sizeBytes:f.size, type:f.type||'application/octet-stream'})});
    let uploadUrl = normalizeSignedUrl(prep.uploadUrl);
    if(!uploadUrl.startsWith('https://')) throw new Error('Signed URL starter ikke med https://');
    log('Signed URL HTTPS: '+uploadUrl.slice(0,55)+'...');
    log('Uploader direkte til Cloudflare R2...');
    // Do not send Content-Type. Server signs only host to avoid FBX/GLB MIME mismatch.
    const put = await fetch(uploadUrl, { method:'PUT', body:f });
    if(!put.ok){ const t=await put.text().catch(()=> ''); throw new Error(`R2 svarede ${put.status}: ${t.slice(0,200)}`); }
    await api('/api/complete-upload', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:email(), key:prep.key, fileName:f.name, sizeBytes:f.size, type:f.type||'application/octet-stream'})});
    document.getElementById('uploadStatus').textContent='Upload færdig.';
    log('UPLOAD OK: '+f.name);
    await loadAccount(); await loadFiles();
  }catch(e){ document.getElementById('uploadStatus').textContent='Upload fejlede.'; log('FEJL upload: '+e.message); }
}
async function loadFiles(){
  try{
    log('Henter bibliotek...'); const d=await api('/api/files?email='+encodeURIComponent(email())); const box=document.getElementById('files');
    if(!d.files.length){ box.className='files empty'; box.textContent='Ingen filer endnu. Upload din første 3D-fil.'; return; }
    box.className='files'; box.innerHTML='';
    d.files.forEach(file=>{
      const el=document.createElement('div'); el.className='file';
      el.innerHTML=`<div><b>${file.originalName}</b><br><small>${fmt(file.sizeBytes)} · ${new Date(file.createdAt).toLocaleString('da-DK')}</small></div><div class="actions"><button data-dl="${file.id}">Download</button><button class="secondary" data-copy="${file.id}">Kopier link</button><button class="secondary" data-del="${file.id}">Slet</button></div>`;
      box.appendChild(el);
    });
    box.querySelectorAll('[data-dl]').forEach(b=>b.onclick=()=>downloadFile(b.dataset.dl));
    box.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>copyLink(b.dataset.copy));
    box.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteFile(b.dataset.del));
    log(`Bibliotek OK: ${d.files.length} filer`);
  }catch(e){ log('FEJL bibliotek: '+e.message); }
}
async function downloadFile(id){
  try{ const d=await api('/api/download-url/'+id+'?email='+encodeURIComponent(email())); window.open(normalizeSignedUrl(d.url),'_blank'); log('Downloadlink åbnet.'); }
  catch(e){ log('FEJL download: '+e.message); }
}
async function copyLink(id){
  try{ const d=await api('/api/download-url/'+id+'?email='+encodeURIComponent(email())); await navigator.clipboard.writeText(normalizeSignedUrl(d.url)); log('Link kopieret.'); }
  catch(e){ log('FEJL kopier link: '+e.message); }
}
async function deleteFile(id){
  if(!confirm('Slet filen?')) return;
  try{ const d=await api('/api/delete-url/'+id+'?email='+encodeURIComponent(email())); const r=await fetch(normalizeSignedUrl(d.url), {method:'DELETE'}); if(!r.ok) throw new Error('R2 delete '+r.status); await api('/api/complete-delete/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email()})}); log('Filen er slettet.'); await loadFiles(); await loadAccount(); }
  catch(e){ log('FEJL slet: '+e.message); }
}
log('Klar. v0.5.4 retter signed URL HTTPS og undgår Content-Type mismatch.');
