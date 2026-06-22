const $ = (id) => document.getElementById(id);
const baseUrl = () => window.location.origin;
function log(msg){ const el=$('log'); if(!el) return; const t=new Date().toLocaleTimeString('da-DK'); el.innerHTML = `<div>[${t}] ${msg}</div>` + el.innerHTML; }
function fmt(bytes){ if(!bytes && bytes!==0) return '—'; const u=['B','KB','MB','GB','TB']; let n=Number(bytes), i=0; while(n>=1024 && i<u.length-1){n/=1024;i++;} return `${n.toFixed(i?1:0)} ${u[i]}`; }
function email(){ return ($('email')?.value || 'vault1973@gmail.com').trim(); }
function setStatus(text, ok=false){ const c=$('statusChip'); if(c){ c.textContent=text; c.classList.toggle('ok',ok); } }
function scrollToApp(){ document.getElementById('app').scrollIntoView({behavior:'smooth'}); }

document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('show'));
  btn.classList.add('active'); document.getElementById(btn.dataset.tab).classList.add('show');
}));

async function testServer(){
  try{ log('Tester server...'); const r=await fetch('/health'); const j=await r.json(); log(`Server OK: v${j.version} · ${j.storageDriver}`); setStatus('Server online', true); $('heroStatus').textContent='Server online'; }
  catch(e){ log('FEJL server: '+e.message); setStatus('Server fejl'); }
}
async function loadAccount(){
  try{ log('Henter konto...'); const r=await fetch(`/api/me?email=${encodeURIComponent(email())}`); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Konto fejl'); const u=j.user; log(`KONTO OK: ${u.plan}`); setStatus(`${u.planName}`, true); $('quotaText').textContent=`${fmt(u.usedBytes)} / ${fmt(u.quotaBytes)}`; const pct = u.quotaBytes ? Math.min(100,(u.usedBytes/u.quotaBytes)*100) : 0; $('quotaBar').style.width=pct+'%'; }
  catch(e){ log('FEJL konto: '+e.message); }
}
async function uploadFile(){
  const f=$('fileInput').files[0]; if(!f){ log('Vælg en fil først.'); return; }
  try{ log(`Uploader via Railway → Worker/R2: ${f.name}`); const fd=new FormData(); fd.append('email', email()); fd.append('file', f); const r=await fetch('/api/upload',{method:'POST',body:fd}); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Upload fejl'); log(`UPLOAD OK: ${j.file.originalName}`); await loadAccount(); await loadFiles(); document.querySelector('[data-tab="library"]').click(); }
  catch(e){ log('FEJL upload: '+e.message); }
}
async function loadFiles(){
  try{ log('Henter bibliotek...'); const r=await fetch(`/api/files?email=${encodeURIComponent(email())}`); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Bibliotek fejl'); renderFiles(j.files||[]); log(`Bibliotek OK: ${(j.files||[]).length} filer`); }
  catch(e){ log('FEJL bibliotek: '+e.message); }
}
function renderFiles(files){
  const box=$('fileList'); if(!files.length){ box.className='file-grid empty'; box.textContent='Ingen filer endnu. Upload din første 3D-fil.'; return; }
  box.className='file-grid'; box.innerHTML=files.map(f=>`<article class="file-card"><strong>${escapeHtml(f.originalName)}</strong><div class="file-meta">${fmt(f.sizeBytes)} · ${new Date(f.createdAt).toLocaleString('da-DK')}</div><div class="file-actions"><a class="btn secondary" href="/api/download/${f.id}?email=${encodeURIComponent(email())}">Download</a><button class="btn danger" onclick="deleteFile('${f.id}')">Slet</button></div></article>`).join('');
}
async function deleteFile(id){
  if(!confirm('Slet filen?')) return;
  try{ log('Sletter fil...'); const r=await fetch(`/api/files/${id}?email=${encodeURIComponent(email())}`,{method:'DELETE'}); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Slet fejl'); log('SLET OK'); await loadAccount(); await loadFiles(); }
  catch(e){ log('FEJL slet: '+e.message); }
}
async function downloadStatus(){
  try{ const r=await fetch('/api/download-status'); const j=await r.json(); if(!j.ok) return; const cards=document.querySelectorAll('.download-card span'); if(cards[0]) cards[0].textContent = j.apk ? 'APK klar til download' : 'APK mangler i public/downloads'; if(cards[1]) cards[1].textContent = j.pc ? 'PC Companion klar' : 'PC Companion ZIP mangler'; }catch{}
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
window.addEventListener('DOMContentLoaded',()=>{ testServer(); downloadStatus(); log('Klar. v0.6.1 Sales Ready UI.'); });
