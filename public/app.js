const $ = (id) => document.getElementById(id);
const state = { email: localStorage.getItem('email') || 'vault1973@gmail.com' };
$('email').value = state.email;
function setMsg(text, type='') { const m=$('message'); m.textContent=text; m.className='message '+type; }
async function json(url, opts) { const r=await fetch(url, opts); if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); }
async function testServer(){
  try{ const d=await json('/health'); $('serverStatus').textContent=`Online v${d.version}`; $('serverStatus').style.color='#16a34a'; setMsg('Serveren svarer.', 'ok'); }
  catch(e){ $('serverStatus').textContent='Offline'; $('serverStatus').style.color='#dc2626'; setMsg('Serveren svarer ikke: '+e.message,'bad'); }
}
async function loadMe(){
  const email=$('email').value.trim(); if(!email) return setMsg('E-mail mangler.','bad');
  localStorage.setItem('email', email); state.email=email;
  try{ const d=await json(`/api/me?email=${encodeURIComponent(email)}`); $('planName').textContent=d.user.planName; $('usedSpace').textContent=d.user.usedHuman || human(d.user.usedBytes); $('freeSpace').textContent=d.user.freeHuman || human(d.user.freeBytes); setMsg('Konto fundet: '+d.user.plan,'ok'); }
  catch(e){ setMsg('Kunne ikke hente konto: '+e.message,'bad'); }
}
function human(bytes){ const u=['B','KB','MB','GB','TB']; let v=Number(bytes||0),i=0; while(v>=1024&&i<u.length-1){v/=1024;i++} return `${v.toFixed(i?2:0)} ${u[i]}`; }
async function uploadFile(){
  const file=$('fileInput').files[0]; const email=$('email').value.trim();
  if(!email) return setMsg('E-mail mangler.','bad'); if(!file) return setMsg('Vælg en fil først.','bad');
  const fd=new FormData(); fd.append('email',email); fd.append('file',file);
  setMsg('Uploader '+file.name+' ...');
  try{ await json('/api/upload',{method:'POST',body:fd}); setMsg('Upload færdig. Filen ligger nu i dit 3D-bibliotek.','ok'); await loadMe(); await loadFiles(); }
  catch(e){ setMsg('Upload mislykkedes: '+e.message,'bad'); }
}
async function loadFiles(){
  const email=$('email').value.trim(); if(!email) return setMsg('E-mail mangler.','bad');
  try{ const d=await json(`/api/files?email=${encodeURIComponent(email)}`); renderFiles(d.files||[]); setMsg('Bibliotek hentet.','ok'); }
  catch(e){ setMsg('Kunne ikke hente filer: '+e.message,'bad'); }
}
function renderFiles(files){
  const wrap=$('files');
  if(!files.length){ wrap.className='files empty'; wrap.textContent='Ingen filer endnu. Upload din første 3D-fil.'; return; }
  wrap.className='files'; wrap.innerHTML='';
  for(const f of files){
    const div=document.createElement('div'); div.className='fileCard';
    div.innerHTML=`<div><h3>${escapeHtml(f.originalName)}</h3><p>${f.extension || ''} · ${f.sizeHuman || human(f.sizeBytes)} · ${new Date(f.createdAt).toLocaleString('da-DK')}</p></div><div class="buttonRow"><a class="btn secondary" href="/api/download/${f.id}?email=${encodeURIComponent(state.email)}">Download</a><button class="btn ghost" data-id="${f.id}">Slet</button></div>`;
    div.querySelector('button').addEventListener('click',()=>deleteFile(f.id)); wrap.appendChild(div);
  }
}
async function deleteFile(id){
  if(!confirm('Slet filen?')) return;
  try{ await json(`/api/files/${id}?email=${encodeURIComponent($('email').value.trim())}`,{method:'DELETE'}); setMsg('Filen er slettet.','ok'); await loadMe(); await loadFiles(); }
  catch(e){ setMsg('Kunne ikke slette: '+e.message,'bad'); }
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
$('testServerBtn').addEventListener('click', testServer); $('loginBtn').addEventListener('click', async()=>{await testServer(); await loadMe(); await loadFiles();}); $('uploadBtn').addEventListener('click', uploadFile); $('refreshFilesBtn').addEventListener('click', loadFiles); $('googleBtn').addEventListener('click',()=>setMsg('Google-login er klar i UI. OAuth keys tilføjes i næste version.'));
testServer(); loadMe().catch(()=>{});
