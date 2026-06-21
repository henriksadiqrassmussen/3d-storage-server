const logEl = () => document.getElementById('log');
function log(msg){ const t = new Date().toLocaleTimeString('da-DK'); logEl().textContent += `[${t}] ${msg}\n`; logEl().scrollTop = logEl().scrollHeight; }
function baseUrl(){
  let v = document.getElementById('baseUrl').value.trim();
  if(!v) v = location.origin;
  if(!/^https?:\/\//i.test(v)) v = 'https://' + v;
  v = v.replace(/\/(health|api\/upload|api\/files).*$/,'').replace(/\/$/,'');
  document.getElementById('baseUrl').value = v;
  return v;
}
function email(){ return document.getElementById('email').value.trim().toLowerCase(); }
function fmt(bytes){
  bytes = Number(bytes)||0; const u=['B','KB','MB','GB','TB']; let i=0; while(bytes>=1024&&i<u.length-1){bytes/=1024;i++;} return `${bytes.toFixed(i?2:0)} ${u[i]}`;
}
async function jsonFetch(url, opts={}){
  const r = await fetch(url, opts);
  const txt = await r.text();
  let data; try{ data = JSON.parse(txt); } catch { data = { ok:false, error:txt || r.statusText }; }
  if(!r.ok || data.ok===false) throw new Error(data.error || r.statusText);
  return data;
}
async function testServer(){
  try{ log('Tester server...'); const data=await jsonFetch(`${baseUrl()}/health`); log(`OK: version ${data.version}, storage ${data.storageDriver}, mode ${data.r2Mode||'normal'}`); }
  catch(e){ log('FEJL server: '+e.message); }
}
async function getAccount(){
  try{
    if(!email()) return log('FEJL: E-mail mangler.');
    log('Henter konto: '+email());
    const data=await jsonFetch(`${baseUrl()}/api/me?email=${encodeURIComponent(email())}`);
    const u=data.user;
    document.getElementById('accountText').innerHTML = `<strong>${u.email}</strong><br>${u.planName} · ${fmt(u.usedBytes)} brugt af ${fmt(u.quotaBytes)}<br>${u.subscriptionStatus}`;
    const pct = Math.min(100, (u.usedBytes/u.quotaBytes)*100);
    document.getElementById('quotaBar').style.width = pct + '%';
    log(`KONTO OK: ${u.email} - ${u.plan}`);
  } catch(e){ log('FEJL konto: '+e.message); }
}
async function uploadFile(){
  const file = document.getElementById('fileInput').files[0];
  if(!file) return log('FEJL: Vælg en fil først.');
  if(!email()) return log('FEJL: E-mail mangler.');
  try{
    log('Forbereder signed upload: '+file.name);
    const signed = await jsonFetch(`${baseUrl()}/api/signed-upload-url`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email:email(), fileName:file.name, sizeBytes:file.size, mimeType:file.type || 'application/octet-stream' })
    });
    log('Uploader direkte til Cloudflare R2...');
    const put = await fetch(signed.uploadUrl, { method:'PUT', headers:{ 'Content-Type': file.type || 'application/octet-stream' }, body:file });
    if(!put.ok) throw new Error(`R2 upload svarede ${put.status}. Tjek R2 bucket CORS.`);
    log('R2 upload OK. Gemmer metadata...');
    await jsonFetch(`${baseUrl()}/api/confirm-upload`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email:email(), id:signed.id, key:signed.key, fileName:file.name, sizeBytes:file.size, mimeType:file.type || 'application/octet-stream' })
    });
    document.getElementById('uploadInfo').textContent = `Upload færdig: ${file.name}`;
    log('UPLOAD OK: '+file.name);
    await getAccount(); await getFiles();
  }catch(e){ log('FEJL upload: '+e.message); }
}
async function getFiles(){
  try{
    if(!email()) return log('FEJL: E-mail mangler.');
    log('Henter bibliotek...');
    const data=await jsonFetch(`${baseUrl()}/api/files?email=${encodeURIComponent(email())}`);
    const wrap=document.getElementById('files');
    if(!data.files.length){ wrap.className='files empty'; wrap.textContent='Ingen filer endnu. Upload din første FBX, GLB, GLTF eller ZIP.'; return; }
    wrap.className='files';
    wrap.innerHTML = data.files.map(f=>`<div class="file"><h3>${escapeHtml(f.originalName)}</h3><small>${f.extension||''} · ${fmt(f.sizeBytes)} · ${new Date(f.createdAt).toLocaleString('da-DK')}</small><div class="actions"><button onclick="downloadFile('${f.id}')">Download</button><button class="secondary" onclick="deleteFile('${f.id}')">Slet</button></div></div>`).join('');
    log(`Bibliotek OK: ${data.files.length} filer`);
  }catch(e){ log('FEJL bibliotek: '+e.message); }
}
async function downloadFile(id){
  try{
    log('Henter download-link...');
    const data=await jsonFetch(`${baseUrl()}/api/download/${id}?email=${encodeURIComponent(email())}`);
    if(data.downloadUrl){ window.open(data.downloadUrl, '_blank'); log('Download-link åbnet.'); }
    else log('Download svar modtaget.');
  }catch(e){ log('FEJL download: '+e.message); }
}
async function deleteFile(id){
  if(!confirm('Slet filen fra biblioteket?')) return;
  try{
    log('Sletter metadata...');
    // Try direct R2 physical delete first, then metadata delete.
    try{
      const d=await jsonFetch(`${baseUrl()}/api/delete-url/${id}?email=${encodeURIComponent(email())}`);
      await fetch(d.deleteUrl,{method:'DELETE'});
      log('R2 objekt slettet direkte.');
    }catch(e){ log('Bemærk: direkte R2-sletning sprang over: '+e.message); }
    await jsonFetch(`${baseUrl()}/api/files/${id}?email=${encodeURIComponent(email())}`, {method:'DELETE'});
    log('SLET OK'); await getFiles(); await getAccount();
  }catch(e){ log('FEJL slet: '+e.message); }
}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
document.getElementById('fileInput').addEventListener('change', e=>{ const f=e.target.files[0]; document.getElementById('uploadInfo').textContent=f?`Valgt: ${f.name} (${fmt(f.size)})`:'Ingen fil valgt.'; });
log('Klar. v0.5.3 bruger signed direct upload til R2.');
