const $ = (id) => document.getElementById(id);
const baseUrl = () => window.location.origin;
let currentLang = localStorage.getItem('3ds-lang') || 'da';

const i18n = {
  da: {
    brandSub:'FBX · GLB · ZIP', navApp:'Upload', navPricing:'Pris', navDownloads:'Downloads', loginTop:'Log ind',
    pill:'Permanent 3D-lager · 1 GB = 1 euro', heroTitle:'Et enkelt sted til dine 3D-filer.', heroLead:'Upload FBX, GLB, GLTF og ZIP. Hent dem igen fra web, PC eller Android — uden teknisk rod.', ctaStart:'Start gratis', ctaDownload:'Hent apps', statusReady:'Server klar', summaryText:'Enkel pris. Permanent R2-lager. Gratis ejerkonto.',
    benefit1Title:'Upload', benefit1Text:'Vælg fil og gem.', benefit2Title:'Hent', benefit2Text:'Download når du vil.', benefit3Title:'Del', benefit3Text:'PC, web og Android.',
    appEyebrow:'Kontrolpanel', appTitle:'Upload og bibliotek', appLead:'Log ind med e-mail, upload en 3D-fil og hent biblioteket.', statusLoggedOut:'Ikke logget ind', step1:'1. Login', emailLabel:'E-mail', testServer:'Test server', getAccount:'Hent konto', step2:'2. Upload', chooseFile:'Vælg 3D-fil', fileTypes:'FBX, GLB, GLTF eller ZIP', uploadBtn:'Upload fil', step3:'3. Bibliotek', refreshLibrary:'Hent', emptyFiles:'Ingen filer endnu.', showLog:'Vis log',
    pricingEyebrow:'Pris', pricingTitle:'Betal kun for den lagerplads du vælger.', month:'md', month2:'md', month3:'md', month4:'md', downloadsEyebrow:'Downloads', downloadsTitle:'Hent appene når de er lagt på serveren.', apkTitle:'Android APK', apkText:'Til telefon', pcTitle:'PC Companion', pcText:'Til Windows', footerText:'v0.6.2 Clean bilingual UI',
    chooseFirst:'Vælg en fil først.', testing:'Tester server...', serverOk:'Server OK', serverError:'FEJL server', loadingAccount:'Henter konto...', accountOk:'KONTO OK', accountError:'FEJL konto', uploading:'Uploader via Railway → Worker/R2', uploadOk:'UPLOAD OK', uploadError:'FEJL upload', loadingLibrary:'Henter bibliotek...', libraryOk:'Bibliotek OK', libraryError:'FEJL bibliotek', noFiles:'Ingen filer endnu.', deleteConfirm:'Slet filen?', deleting:'Sletter fil...', deleteOk:'SLET OK', deleteError:'FEJL slet', download:'Download', delete:'Slet', ready:'Klar. v0.6.2 rent dansk/engelsk UI.'
  },
  en: {
    brandSub:'FBX · GLB · ZIP', navApp:'Upload', navPricing:'Pricing', navDownloads:'Downloads', loginTop:'Sign in',
    pill:'Permanent 3D storage · 1 GB = 1 euro', heroTitle:'One simple place for your 3D files.', heroLead:'Upload FBX, GLB, GLTF and ZIP. Download them again from web, PC or Android — without technical mess.', ctaStart:'Start free', ctaDownload:'Get apps', statusReady:'Server ready', summaryText:'Simple pricing. Permanent R2 storage. Free owner account.',
    benefit1Title:'Upload', benefit1Text:'Choose a file and save it.', benefit2Title:'Download', benefit2Text:'Get your files anytime.', benefit3Title:'Connect', benefit3Text:'PC, web and Android.',
    appEyebrow:'Control panel', appTitle:'Upload and library', appLead:'Sign in with e-mail, upload a 3D file and load your library.', statusLoggedOut:'Not signed in', step1:'1. Sign in', emailLabel:'E-mail', testServer:'Test server', getAccount:'Get account', step2:'2. Upload', chooseFile:'Choose 3D file', fileTypes:'FBX, GLB, GLTF or ZIP', uploadBtn:'Upload file', step3:'3. Library', refreshLibrary:'Load', emptyFiles:'No files yet.', showLog:'Show log',
    pricingEyebrow:'Pricing', pricingTitle:'Pay only for the storage you choose.', month:'mo', month2:'mo', month3:'mo', month4:'mo', downloadsEyebrow:'Downloads', downloadsTitle:'Download the apps when they are added to the server.', apkTitle:'Android APK', apkText:'For phone', pcTitle:'PC Companion', pcText:'For Windows', footerText:'v0.6.2 Clean bilingual UI',
    chooseFirst:'Choose a file first.', testing:'Testing server...', serverOk:'Server OK', serverError:'SERVER ERROR', loadingAccount:'Loading account...', accountOk:'ACCOUNT OK', accountError:'ACCOUNT ERROR', uploading:'Uploading via Railway → Worker/R2', uploadOk:'UPLOAD OK', uploadError:'UPLOAD ERROR', loadingLibrary:'Loading library...', libraryOk:'Library OK', libraryError:'LIBRARY ERROR', noFiles:'No files yet.', deleteConfirm:'Delete this file?', deleting:'Deleting file...', deleteOk:'DELETE OK', deleteError:'DELETE ERROR', download:'Download', delete:'Delete', ready:'Ready. v0.6.2 clean Danish/English UI.'
  }
};
function t(key){ return (i18n[currentLang] && i18n[currentLang][key]) || i18n.da[key] || key; }
function applyLang(){
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el=>{ const key=el.dataset.i18n; el.textContent=t(key); });
  $('langDa')?.classList.toggle('active', currentLang==='da');
  $('langEn')?.classList.toggle('active', currentLang==='en');
  localStorage.setItem('3ds-lang', currentLang);
  const fileBox = $('fileList'); if(fileBox && fileBox.classList.contains('empty')) fileBox.textContent=t('emptyFiles');
}
function setLang(lang){ currentLang = lang; applyLang(); log(currentLang==='da'?'Sprog: Dansk':'Language: English'); }
function log(msg){ const el=$('log'); if(!el) return; const tme=new Date().toLocaleTimeString(currentLang==='da'?'da-DK':'en-GB'); el.innerHTML = `<div>[${tme}] ${escapeHtml(msg)}</div>` + el.innerHTML; }
function fmt(bytes){ if(!bytes && bytes!==0) return '—'; const u=['B','KB','MB','GB','TB']; let n=Number(bytes), i=0; while(n>=1024 && i<u.length-1){n/=1024;i++;} return `${n.toFixed(i?1:0)} ${u[i]}`; }
function email(){ return ($('email')?.value || 'vault1973@gmail.com').trim(); }
function setStatus(text, ok=false){ const c=$('statusChip'); if(c){ c.textContent=text; c.classList.toggle('ok',ok); } }
async function testServer(){
  try{ log(t('testing')); const r=await fetch('/health'); const j=await r.json(); log(`${t('serverOk')}: v${j.version} · ${j.storageDriver}`); setStatus(t('statusReady'), true); }
  catch(e){ log(`${t('serverError')}: ${e.message}`); setStatus(t('serverError')); }
}
async function loadAccount(){
  try{ log(t('loadingAccount')); const r=await fetch(`/api/me?email=${encodeURIComponent(email())}`); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Account error'); const u=j.user; log(`${t('accountOk')}: ${u.plan}`); setStatus(`${u.planName}`, true); $('quotaText').textContent=`${fmt(u.usedBytes)} / ${fmt(u.quotaBytes)}`; const pct = u.quotaBytes ? Math.min(100,(u.usedBytes/u.quotaBytes)*100) : 0; $('quotaBar').style.width=pct+'%'; }
  catch(e){ log(`${t('accountError')}: ${e.message}`); }
}
async function uploadFile(){
  const f=$('fileInput').files[0]; if(!f){ log(t('chooseFirst')); return; }
  try{ log(`${t('uploading')}: ${f.name}`); const fd=new FormData(); fd.append('email', email()); fd.append('file', f); const r=await fetch('/api/upload',{method:'POST',body:fd}); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Upload error'); log(`${t('uploadOk')}: ${j.file.originalName}`); await loadAccount(); await loadFiles(); }
  catch(e){ log(`${t('uploadError')}: ${e.message}`); }
}
async function loadFiles(){
  try{ log(t('loadingLibrary')); const r=await fetch(`/api/files?email=${encodeURIComponent(email())}`); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Library error'); renderFiles(j.files||[]); log(`${t('libraryOk')}: ${(j.files||[]).length}`); }
  catch(e){ log(`${t('libraryError')}: ${e.message}`); }
}
function renderFiles(files){
  const box=$('fileList'); if(!files.length){ box.className='file-list empty'; box.textContent=t('noFiles'); return; }
  box.className='file-list'; box.innerHTML=files.map(f=>`<article class="file-card"><strong>${escapeHtml(f.originalName)}</strong><div class="file-meta">${fmt(f.sizeBytes)} · ${new Date(f.createdAt).toLocaleString(currentLang==='da'?'da-DK':'en-GB')}</div><div class="file-actions"><a class="btn secondary small" href="/api/download/${f.id}?email=${encodeURIComponent(email())}">${t('download')}</a><button class="btn danger small" onclick="deleteFile('${f.id}')">${t('delete')}</button></div></article>`).join('');
}
async function deleteFile(id){
  if(!confirm(t('deleteConfirm'))) return;
  try{ log(t('deleting')); const r=await fetch(`/api/files/${id}?email=${encodeURIComponent(email())}`,{method:'DELETE'}); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Delete error'); log(t('deleteOk')); await loadAccount(); await loadFiles(); }
  catch(e){ log(`${t('deleteError')}: ${e.message}`); }
}
async function downloadStatus(){
  try{ const r=await fetch('/api/download-status'); const j=await r.json(); if(!j.ok) return; const cards=document.querySelectorAll('.download-card span'); if(cards[0]) cards[0].textContent = j.apk ? (currentLang==='da'?'APK klar':'APK ready') : (currentLang==='da'?'APK mangler':'APK missing'); if(cards[1]) cards[1].textContent = j.pc ? (currentLang==='da'?'PC Companion klar':'PC Companion ready') : (currentLang==='da'?'PC ZIP mangler':'PC ZIP missing'); }catch{}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
window.addEventListener('DOMContentLoaded',()=>{ applyLang(); testServer(); downloadStatus(); log(t('ready')); });
