const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase();
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'local';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const DB_FILE = path.join(UPLOAD_DIR, 'db.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function readDb(){ try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return { files: [] }; } }
function writeDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function emailOf(req){ return String(req.query.email || req.body?.email || '').trim().toLowerCase(); }
function planFor(email){
  if (email === OWNER_EMAIL) return { plan:'OWNER_FREE', planName:'Owner free', quotaBytes: 10 * 1024**4, subscriptionStatus:'owner_free', priceEuro:0 };
  return { plan:'FREE_TEST', planName:'Free test', quotaBytes: 1 * 1024**3, subscriptionStatus:'free_test', priceEuro:0 };
}
function userFor(email){
  const db = readDb();
  const p = planFor(email);
  const usedBytes = db.files.filter(f => f.email === email).reduce((a,f)=>a + Number(f.sizeBytes||0), 0);
  return { email, ...p, usedBytes, freeBytes: Math.max(0, p.quotaBytes - usedBytes) };
}
function safeName(name){ return String(name || 'file.bin').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180); }
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + crypto.randomBytes(5).toString('hex') + '_' + safeName(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: Number(process.env.MAX_FILE_BYTES || 1024 * 1024 * 1024) } });

app.get('/health', (req,res)=>res.json({ ok:true, version:'0.3.3', storageDriver: STORAGE_DRIVER }));
app.get('/api/me', (req,res)=>{
  const email = emailOf(req);
  if(!email) return res.status(400).json({ ok:false, error:'email_required' });
  res.json({ ok:true, user:userFor(email) });
});
app.get('/api/files', (req,res)=>{
  const email = emailOf(req);
  if(!email) return res.status(400).json({ ok:false, error:'email_required' });
  const db = readDb();
  const files = db.files.filter(f => f.email === email).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ ok:true, files });
});
app.post('/api/upload', upload.single('file'), (req,res)=>{
  const email = emailOf(req);
  if(!email) { if(req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ ok:false, error:'email_required' }); }
  if(!req.file) return res.status(400).json({ ok:false, error:'file_required' });
  const u = userFor(email);
  if (u.usedBytes + req.file.size > u.quotaBytes) { fs.unlinkSync(req.file.path); return res.status(403).json({ ok:false, error:'quota_exceeded', user:u }); }
  const originalName = safeName(req.file.originalname);
  const ext = path.extname(originalName).replace('.','').toLowerCase();
  const allowed = new Set(['fbx','glb','gltf','zip']);
  if(!allowed.has(ext)){ fs.unlinkSync(req.file.path); return res.status(400).json({ ok:false, error:'filetype_not_allowed' }); }
  const db = readDb();
  const rec = { id: crypto.randomUUID(), email, originalName, storageKey: path.basename(req.file.path), sizeBytes: req.file.size, extension: ext, mimeType:req.file.mimetype, createdAt:new Date().toISOString(), storageDriver:STORAGE_DRIVER, downloadCount:0 };
  db.files.push(rec); writeDb(db);
  res.json({ ok:true, file:rec, user:userFor(email) });
});
app.get('/api/download/:id', (req,res)=>{
  const email = emailOf(req);
  const db = readDb();
  const f = db.files.find(x => x.id === req.params.id && (!email || x.email === email));
  if(!f) return res.status(404).json({ ok:false, error:'file_not_found' });
  const fp = path.join(UPLOAD_DIR, f.storageKey);
  if(!fs.existsSync(fp)) return res.status(404).json({ ok:false, error:'stored_file_missing' });
  f.downloadCount = Number(f.downloadCount||0) + 1; writeDb(db);
  res.download(fp, f.originalName);
});
app.delete('/api/files/:id', (req,res)=>{
  const email = emailOf(req);
  if(!email) return res.status(400).json({ ok:false, error:'email_required' });
  const db = readDb();
  const idx = db.files.findIndex(x => x.id === req.params.id && x.email === email);
  if(idx < 0) return res.status(404).json({ ok:false, error:'file_not_found' });
  const [f] = db.files.splice(idx, 1);
  const fp = path.join(UPLOAD_DIR, f.storageKey);
  if(fs.existsSync(fp)) fs.unlinkSync(fp);
  writeDb(db);
  res.json({ ok:true, deleted:f.id, user:userFor(email) });
});
app.get('/', (req,res)=>res.type('html').send(`<h1>3D Storage Server</h1><p>Version 0.3.3</p><p>Health: <a href="/health">/health</a></p>`));
app.listen(PORT, ()=>console.log(`3D Storage server v0.3.3 running on ${PORT}`));
