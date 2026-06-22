const $ = (id) => document.getElementById(id);
let currentLang = localStorage.getItem('3ds-lang') || 'da';

const i18n = {
  da: {
    brandSub:'Cloud storage til 3D-filer', navHome:'Forside', navApp:'App', navPricing:'Priser', navDownloads:'Downloads', headerCta:'Åbn app',
    heroEyebrow:'Permanent 3D-lager', heroTitle:'Gem dine 3D-filer ét sted.', heroLead:'Upload FBX, GLB, GLTF og ZIP. Hent dem igen fra web, PC og Android i et enkelt og professionelt system.', heroPrimary:'Start gratis', heroSecondary:'Hent apps',
    feature1Title:'Enkel upload', feature1Text:'Vælg fil, upload og se den i biblioteket.', feature2Title:'Permanent lager', feature2Text:'Dine filer gemmes i Cloudflare R2.', feature3Title:'Web, PC og Android', feature3Text:'Brug samme bibliotek på tværs af enheder.',
    appEyebrow:'Kontrolpanel', appTitle:'Login, upload og bibliotek', appLead:'Log ind med e-mail, upload en fil og hent dit bibliotek.', statusLoggedOut:'Ikke logget ind', statusLoggedIn:'Klar',
    step1:'1. Login', emailLabel:'E-mail', testServer:'Test server', getAccount:'Hent konto', step2:'2. Upload', chooseFile:'Vælg 3D-fil', fileTypes:'FBX, GLB, GLTF eller ZIP', uploadBtn:'Upload fil', step3:'3. Bibliotek', refreshLibrary:'Hent bibliotek', emptyFiles:'Ingen filer endnu.',
    showLog:'Vis log', pricingEyebrow:'Priser', pricingTitle:'Vælg lagerplads efter behov.', pricingLead:'Ingen prisblokke på forsiden. Her ser du hele prislisten.', month1:'måned', month2:'måned', month3:'måned', month4:'måned',
    downloadsEyebrow:'Downloads', downloadsTitle:'Hent apps og værktøjer.', downloadsLead:'Download Android APK og PC Companion, når de ligger på serveren.', apkTitle:'Android APK', apkText:'Til telefon', pcTitle:'PC Companion', pcText:'Til Windows', footerText:'v0.6.3 Clean UI med assets',
    chooseFirst:'Vælg en fil først.', testing:'Tester server...', serverOk:'Server OK', serverError:'FEJL server', loadingAccount:'Henter konto...', accountOk:'KONTO OK', accountError:'FEJL konto', uploading:'Uploader via Railway → Worker/R2', uploadOk:'UPLOAD OK', uploadError:'FEJL upload', loadingLibrary:'Henter bibliotek...', libraryOk:'Bibliotek OK', libraryError:'FEJL bibliotek', noFiles:'Ingen filer endnu.', deleteConfirm:'Slet filen?', deleting:'Sletter fil...', deleteOk:'SLET OK', deleteError:'FEJL slet', download:'Download', delete:'Slet', ready:'Klar. v0.6.3 bruger assets, ren forside og DA/EN UI.', apkReady:'APK klar', apkMissing:'APK mangler', pcReady:'PC Companion klar', pcMissing:'PC Companion mangler'
  },
  en: {
    brandSub:'Cloud storage for 3D files', navHome:'Home', navApp:'App', navPricing:'Pricing', navDownloads:'Downloads', headerCta:'Open app',
    heroEyebrow:'Permanent 3D storage', heroTitle:'Keep your 3D files in one place.', heroLead:'Upload FBX, GLB, GLTF and ZIP. Download them again from web, PC and Android in one simple and professional system.', heroPrimary:'Start free', heroSecondary:'Get apps',
    feature1Title:'Simple upload', feature1Text:'Choose a file, upload it and see it in your library.', feature2Title:'Permanent storage', feature2Text:'Your files are stored in Cloudflare R2.', feature3Title:'Web, PC and Android', feature3Text:'Use the same library across devices.',
    appEyebrow:'Control panel', appTitle:'Login, upload and library', appLead:'Sign in with e-mail, upload a file and load your library.', statusLoggedOut:'Signed out', statusLoggedIn:'Ready',
    step1:'1. Login', emailLabel:'E-mail', testServer:'Test server', getAccount:'Get account', step2:'2. Upload', chooseFile:'Choose 3D file', fileTypes:'FBX, GLB, GLTF or ZIP', uploadBtn:'Upload file', step3:'3. Library', refreshLibrary:'Load library', emptyFiles:'No files yet.',
    showLog:'Show log', pricingEyebrow:'Pricing', pricingTitle:'Choose storage space when you need it.', pricingLead:'No pricing blocks on the front page. See the full pricing here.', month1:'month', month2:'month', month3:'month', month4:'month',
    downloadsEyebrow:'Downloads', downloadsTitle:'Get apps and tools.', downloadsLead:'Download the Android APK and PC Companion when they are available.', apkTitle:'Android APK', apkText:'For phone', pcTitle:'PC Companion', pcText:'For Windows', footerText:'v0.6.3 Clean UI with assets',
    chooseFirst:'Choose a file first.', testing:'Testing server...', serverOk:'Server OK', serverError:'ERROR server', loadingAccount:'Loading account...', accountOk:'ACCOUNT OK', accountError:'ERROR account', uploading:'Uploading via Railway → Worker/R2', uploadOk:'UPLOAD OK', uploadError:'ERROR upload', loadingLibrary:'Loading library...', libraryOk:'Library OK', libraryError:'ERROR library', noFiles:'No files yet.', deleteConfirm:'Delete the file?', deleting:'Deleting file...', deleteOk:'DELETE OK', deleteError:'ERROR delete', download:'Download', delete:'Delete', ready:'Ready. v0.6.3 uses assets, a clean front page and DA/EN UI.', apkReady:'APK ready', apkMissing:'APK missing', pcReady:'PC Companion ready', pcMissing:'PC Companion missing'
  }
};

function t(key){ return (i18n[currentLang] && i18n[currentLang][key]) || key; }
function log(msg){ const box=$('log'); const ts=new Date().toLocaleTimeString(currentLang==='da'?'da-DK':'en-GB',{hour12:false}); box.innerHTML = `[${ts}] ${msg}<br>` + box.innerHTML; }
function email(){ return $('email').value.trim(); }
function fmt(bytes){ if(!bytes) return '0 B'; const units=['B','KB','MB','GB','TB']; let n=bytes, i=0; while(n>=1024 && i<units.length-1){ n/=1024; i++; } return `${n.toFixed(n>=10||i===0?0:1)} ${units[i]}`; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function applyLang(){
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el=>{ const key = el.getAttribute('data-i18n'); el.textContent = t(key); });
  $('langDa').classList.toggle('active', currentLang==='da'); $('langEn').classList.toggle('active', currentLang==='en');
  downloadStatus();
}
function setLang(lang){ currentLang = lang; localStorage.setItem('3ds-lang', lang); applyLang(); }
function showPage(page){
  document.querySelectorAll('.page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(el=>el.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`.nav-link[data-page="${page}"]`)?.classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
}
async function testServer(){
  try { log(t('testing')); const r=await fetch('/health'); const j=await r.json(); if(!j.ok) throw new Error('Health failed'); log(`${t('serverOk')}: v${j.version}`); }
  catch(e){ log(`${t('serverError')}: ${e.message}`); }
}
async function loadAccount(){
  if(!email()) return log(t('accountError') + ': e-mail mangler');
  try { log(t('loadingAccount')); const r=await fetch(`/api/me?email=${encodeURIComponent(email())}`); const j=await r.json(); if(!j.ok) throw new Error(j.error || 'Account error'); const u=j.user; $('statusChip').textContent = `${t('statusLoggedIn')}: ${u.plan}`; $('statusChip').classList.add('ok'); $('quotaText').textContent = `${u.planName} · ${fmt(u.usedBytes)} / ${fmt(u.quotaBytes)}`; const percent = Math.min(100, (u.usedBytes / Math.max(1,u.quotaBytes)) * 100); $('quotaBar').style.width = percent + '%'; log(`${t('accountOk')}: ${u.plan}`); }
  catch(e){ log(`${t('accountError')}: ${e.message}`); }
}
async function uploadFile(){
  const file = $('fileInput').files[0];
  if(!file) return log(t('chooseFirst'));
  try { const fd = new FormData(); fd.append('email', email()); fd.append('file', file); log(`${t('uploading')}: ${file.name}`); const r=await fetch('/api/upload',{method:'POST', body:fd}); const j=await r.json(); if(!j.ok) throw new Error(j.error || 'Upload error'); log(`${t('uploadOk')}: ${j.file.originalName}`); await loadAccount(); await loadFiles(); }
  catch(e){ log(`${t('uploadError')}: ${e.message}`); }
}
async function loadFiles(){
  try { log(t('loadingLibrary')); const r=await fetch(`/api/files?email=${encodeURIComponent(email())}`); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Library error'); renderFiles(j.files||[]); log(`${t('libraryOk')}: ${(j.files||[]).length} filer`); }
  catch(e){ log(`${t('libraryError')}: ${e.message}`); }
}
function renderFiles(files){
  const box=$('fileList');
  if(!files.length){ box.className='file-list empty'; box.textContent=t('noFiles'); return; }
  box.className='file-list';
  box.innerHTML = files.map(f=>`<article class="file-card"><strong>${escapeHtml(f.originalName)}</strong><div class="file-meta">${fmt(f.sizeBytes)} · ${new Date(f.createdAt).toLocaleString(currentLang==='da'?'da-DK':'en-GB')}</div><div class="file-actions"><a class="btn btn-secondary small" href="/api/download/${f.id}?email=${encodeURIComponent(email())}">${t('download')}</a><button class="btn btn-danger small" onclick="deleteFile('${f.id}')">${t('delete')}</button></div></article>`).join('');
}
async function deleteFile(id){
  if(!confirm(t('deleteConfirm'))) return;
  try { log(t('deleting')); const r=await fetch(`/api/files/${id}?email=${encodeURIComponent(email())}`,{method:'DELETE'}); const j=await r.json(); if(!j.ok) throw new Error(j.error||'Delete error'); log(t('deleteOk')); await loadAccount(); await loadFiles(); }
  catch(e){ log(`${t('deleteError')}: ${e.message}`); }
}
async function downloadStatus(){
  try{ const r=await fetch('/api/download-status'); const j=await r.json(); if(!j.ok) return; const apk = $('apkStatus'); const pc = $('pcStatus'); if(apk) apk.textContent = j.apk ? t('apkReady') : t('apkMissing'); if(pc) pc.textContent = j.pc ? t('pcReady') : t('pcMissing'); }
  catch{}
}
window.addEventListener('DOMContentLoaded',()=>{ applyLang(); showPage('home'); testServer(); downloadStatus(); log(t('ready')); });
