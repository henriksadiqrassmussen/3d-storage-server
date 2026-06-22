const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
const VERSION = '0.6.5';

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase().trim();
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'r2-worker';
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET || '';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const dbPath = path.join(__dirname, 'data.json');
function readDb(){
  try { return JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch { return { files: [] }; }
}
function writeDb(db){ fs.writeFileSync(dbPath, JSON.stringify(db, null, 2)); }
function cleanEmail(email){ return String(email || '').toLowerCase().trim(); }
function safeName(name){ return String(name || 'file.bin').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120); }
function planFor(email){
  if (cleanEmail(email) === OWNER_EMAIL) return { plan:'OWNER_FREE', planName:'Owner free', quotaBytes: 10 * 1024 ** 4, subscriptionStatus:'owner_free', priceEuro:0 };
  return { plan:'FREE_TEST', planName:'Free test', quotaBytes: 1 * 1024 ** 3, subscriptionStatus:'free_test', priceEuro:0 };
}
function userFiles(email){ return readDb().files.filter(f => cleanEmail(f.email) === cleanEmail(email)); }
function usedBytes(email){ return userFiles(email).reduce((sum, f) => sum + (Number(f.sizeBytes)||0), 0); }
function userInfo(email){ const p = planFor(email); const used = usedBytes(email); return { email: cleanEmail(email), ...p, usedBytes: used, freeBytes: Math.max(0, p.quotaBytes - used) }; }
function workerHeaders(){ return { 'x-worker-secret': WORKER_SHARED_SECRET }; }
async function workerFetch(url, opts={}){
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers||{}), ...workerHeaders() } });
  return res;
}

app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', async (req,res)=>{
  let workerPing = false;
  if (WORKER_URL && WORKER_SHARED_SECRET) {
    try { const r = await fetch(WORKER_URL + '/health'); const j = await r.json(); workerPing = !!j.ok && !!j.bucketReady; } catch {}
  }
  res.json({ ok:true, version:VERSION, storageDriver:STORAGE_DRIVER, pricing:'1GB=1EUR', node:process.version, r2Mode:'railway-worker-proxy-sales-polish', workerReady: !!(WORKER_URL && WORKER_SHARED_SECRET && workerPing), workerUrlSet: !!WORKER_URL, workerSecretSet: !!WORKER_SHARED_SECRET, workerPing, ui:'sales-polish-no-free-cta' });
});
app.get('/api/me', (req,res)=>{
  const email = cleanEmail(req.query.email);
  if(!email) return res.status(400).json({ok:false,error:'E-mail mangler'});
  res.json({ok:true,user:userInfo(email)});
});
app.get('/api/files', (req,res)=>{
  const email = cleanEmail(req.query.email);
  if(!email) return res.status(400).json({ok:false,error:'E-mail mangler'});
  res.json({ok:true,files:userFiles(email).sort((a,b)=>b.createdAt-a.createdAt)});
});
app.post('/api/upload', upload.single('file'), async (req,res)=>{
  try {
    const email = cleanEmail(req.body.email);
    if(!email) return res.status(400).json({ok:false,error:'E-mail mangler'});
    if(!req.file) return res.status(400).json({ok:false,error:'Fil mangler'});
    const u = userInfo(email);
    if (req.file.size > u.freeBytes) return res.status(403).json({ok:false,error:'Du har ikke nok ledig lagerplads'});
    if (STORAGE_DRIVER !== 'r2-worker' || !WORKER_URL || !WORKER_SHARED_SECRET) return res.status(500).json({ok:false,error:'Worker/R2 er ikke klar'});
    const id = crypto.randomUUID();
    const originalName = safeName(req.file.originalname);
    const key = `users/${encodeURIComponent(email)}/${Date.now()}_${id}_${originalName}`;
    const url = `${WORKER_URL}/upload?key=${encodeURIComponent(key)}`;
    const wr = await workerFetch(url, { method:'PUT', body:req.file.buffer, headers:{ 'content-type': req.file.mimetype || 'application/octet-stream' } });
    if(!wr.ok){ const t = await wr.text(); return res.status(wr.status).json({ok:false,error:`Worker upload HTTP ${wr.status}: ${t}`}); }
    const file = { id, email, originalName, storageKey:key, sizeBytes:req.file.size, mimeType:req.file.mimetype || 'application/octet-stream', extension:path.extname(originalName).toLowerCase(), createdAt:Date.now(), downloadCount:0 };
    const db = readDb(); db.files.push(file); writeDb(db);
    res.json({ok:true,file,user:userInfo(email)});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
app.get('/api/download/:id', async (req,res)=>{
  const email = cleanEmail(req.query.email);
  const db = readDb(); const file = db.files.find(f=>f.id===req.params.id && cleanEmail(f.email)===email);
  if(!file) return res.status(404).send('File not found');
  const wr = await workerFetch(`${WORKER_URL}/download?key=${encodeURIComponent(file.storageKey)}`);
  if(!wr.ok) return res.status(wr.status).send(await wr.text());
  file.downloadCount = (file.downloadCount||0)+1; writeDb(db);
  res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
  const arr = Buffer.from(await wr.arrayBuffer());
  res.send(arr);
});
app.delete('/api/files/:id', async (req,res)=>{
  const email = cleanEmail(req.query.email);
  const db = readDb(); const idx = db.files.findIndex(f=>f.id===req.params.id && cleanEmail(f.email)===email);
  if(idx<0) return res.status(404).json({ok:false,error:'Filen blev ikke fundet'});
  const file = db.files[idx];
  const wr = await workerFetch(`${WORKER_URL}/delete?key=${encodeURIComponent(file.storageKey)}`, { method:'DELETE' });
  if(!wr.ok) return res.status(wr.status).json({ok:false,error:await wr.text()});
  db.files.splice(idx,1); writeDb(db);
  res.json({ok:true,user:userInfo(email)});
});
app.get('/api/download-status',(req,res)=>{
  const downloads = path.join(__dirname,'public','downloads');
  const apk = fs.existsSync(path.join(downloads,'3d-storage-android.apk'));
  const pc = fs.existsSync(path.join(downloads,'3D_Storage_PC_Companion.zip'));
  res.json({ok:true,apk,pc});
});

app.listen(PORT, ()=> console.log(`3D Storage v${VERSION} running on ${PORT}`));
