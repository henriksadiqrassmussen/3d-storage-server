const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '0.5.3';
const PRICE_TEXT = '1GB=1EUR';

app.use(cors({ origin: '*', methods: ['GET','POST','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase().trim();
const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase().trim();
const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || '').replace(/^https?:\/\//,'').replace(/\.r2\.cloudflarestorage\.com\/?$/,'').trim();
const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET = (process.env.R2_BUCKET || '').trim();
const R2_READY = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
const R2_ENDPOINT = R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '';

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const dbPath = path.join(__dirname, 'files-db.json');
function loadDb(){ try { return JSON.parse(fs.readFileSync(dbPath,'utf8')); } catch { return { files: [] }; } }
function saveDb(db){ try { fs.writeFileSync(dbPath, JSON.stringify(db,null,2)); } catch(e){ console.error('saveDb failed', e.message); } }
function safeEmail(email){ return String(email || '').toLowerCase().trim(); }
function safeName(name){ return String(name || 'file.bin').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,180); }
function userPlan(email){
  const e = safeEmail(email);
  if (e === OWNER_EMAIL) return { email:e, plan:'OWNER_FREE', planName:'Owner free', quotaBytes: 10*1024*1024*1024*1024, subscriptionStatus:'owner_free', priceEuro:0 };
  return { email:e, plan:'FREE_TEST', planName:'Free test', quotaBytes: 1*1024*1024*1024, subscriptionStatus:'free_test', priceEuro:0 };
}
function usedBytes(email){ return loadDb().files.filter(f=>f.email===safeEmail(email) && !f.deleted).reduce((a,f)=>a+(Number(f.sizeBytes)||0),0); }
function publicFile(f){ return { id:f.id, email:f.email, originalName:f.originalName, sizeBytes:f.sizeBytes, mimeType:f.mimeType, extension:f.extension, createdAt:f.createdAt, storageDriver:f.storageDriver, key:f.key }; }
function getS3(){
  return new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    forcePathStyle: true
  });
}
function requireEmail(req,res){
  const email = safeEmail(req.query.email || req.body.email);
  if (!email || !email.includes('@')) { res.status(400).json({ ok:false, error:'E-mail mangler.' }); return null; }
  return email;
}

app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/health', (req,res)=> res.json({ ok:true, version:VERSION, storageDriver:STORAGE_DRIVER, r2Ready:R2_READY, pricing:PRICE_TEXT, node:process.version, r2EndpointHost: R2_ACCOUNT_ID ? `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null, r2Mode:'signed-direct-upload' }));
app.get('/api/me', (req,res)=>{
  const email = requireEmail(req,res); if(!email) return;
  const plan = userPlan(email); const used = usedBytes(email);
  res.json({ ok:true, user:{ ...plan, usedBytes:used, freeBytes:Math.max(0, plan.quotaBytes-used) } });
});
app.get('/api/files', (req,res)=>{
  const email = requireEmail(req,res); if(!email) return;
  const files = loadDb().files.filter(f=>f.email===email && !f.deleted).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(publicFile);
  res.json({ ok:true, files });
});

// Legacy multipart local upload fallback. R2 mode should use signed upload endpoint below.
const upload = multer({ dest: uploadDir });
app.post('/api/upload', upload.single('file'), (req,res)=>{
  const email = safeEmail(req.body.email); if(!email) return res.status(400).json({ ok:false, error:'E-mail mangler.' });
  if(!req.file) return res.status(400).json({ ok:false, error:'Fil mangler.' });
  if(STORAGE_DRIVER === 'r2') return res.status(400).json({ ok:false, error:'Brug signed upload i R2 mode: /api/signed-upload-url' });
  const plan=userPlan(email); const used=usedBytes(email);
  if(used + req.file.size > plan.quotaBytes) return res.status(403).json({ ok:false, error:'Du har ikke nok ledig lagerplads.' });
  const id = crypto.randomUUID();
  const ext = path.extname(req.file.originalname).toLowerCase();
  const finalName = `${id}${ext}`;
  fs.renameSync(req.file.path, path.join(uploadDir, finalName));
  const db=loadDb();
  db.files.push({ id, email, originalName:req.file.originalname, sizeBytes:req.file.size, mimeType:req.file.mimetype, extension:ext, createdAt:new Date().toISOString(), storageDriver:'local', key:finalName });
  saveDb(db);
  res.json({ ok:true, file:publicFile(db.files[db.files.length-1]) });
});

app.post('/api/signed-upload-url', async (req,res)=>{
  try{
    const email = requireEmail(req,res); if(!email) return;
    if(STORAGE_DRIVER !== 'r2') return res.status(400).json({ ok:false, error:'Signed upload bruges kun når STORAGE_DRIVER=r2.' });
    if(!R2_READY) return res.status(500).json({ ok:false, error:'R2 variables mangler.' });
    const originalName = safeName(req.body.fileName);
    const sizeBytes = Number(req.body.sizeBytes || 0);
    const mimeType = req.body.mimeType || 'application/octet-stream';
    if(!originalName || !sizeBytes) return res.status(400).json({ ok:false, error:'Filnavn eller størrelse mangler.' });
    const allowed = ['.fbx','.glb','.gltf','.zip'];
    const ext = path.extname(originalName).toLowerCase();
    if(!allowed.includes(ext)) return res.status(400).json({ ok:false, error:'Kun FBX, GLB, GLTF og ZIP er tilladt.' });
    const plan=userPlan(email); const used=usedBytes(email);
    if(used + sizeBytes > plan.quotaBytes) return res.status(403).json({ ok:false, error:'Du har ikke nok ledig lagerplads.' });
    const id = crypto.randomUUID();
    const key = `users/${email.replace(/[^a-z0-9@._-]/g,'_')}/${Date.now()}_${id}_${originalName}`;
    const cmd = new PutObjectCommand({ Bucket:R2_BUCKET, Key:key, ContentType:mimeType });
    const uploadUrl = await getSignedUrl(getS3(), cmd, { expiresIn: 900 });
    res.json({ ok:true, id, key, uploadUrl, expiresIn:900, method:'PUT', headers:{ 'Content-Type': mimeType } });
  }catch(err){ res.status(500).json({ ok:false, error:err.message, hint:'Signed URL fejlede. Tjek R2 credentials.' }); }
});

app.post('/api/confirm-upload', (req,res)=>{
  const email = requireEmail(req,res); if(!email) return;
  const { id, key, fileName, sizeBytes, mimeType } = req.body;
  if(!id || !key || !fileName) return res.status(400).json({ ok:false, error:'Upload-data mangler.' });
  const db=loadDb();
  if(db.files.some(f=>f.id===id)) return res.json({ ok:true, file:publicFile(db.files.find(f=>f.id===id)) });
  const ext = path.extname(fileName).toLowerCase();
  const rec = { id, email, originalName:safeName(fileName), sizeBytes:Number(sizeBytes)||0, mimeType:mimeType||'application/octet-stream', extension:ext, createdAt:new Date().toISOString(), storageDriver:'r2', key, deleted:false };
  db.files.push(rec); saveDb(db);
  res.json({ ok:true, file:publicFile(rec) });
});

app.get('/api/download/:id', async (req,res)=>{
  try{
    const email = requireEmail(req,res); if(!email) return;
    const f = loadDb().files.find(x=>x.id===req.params.id && x.email===email && !x.deleted);
    if(!f) return res.status(404).json({ ok:false, error:'Filen blev ikke fundet.' });
    if(f.storageDriver === 'local') return res.download(path.join(uploadDir, f.key), f.originalName);
    const cmd = new GetObjectCommand({ Bucket:R2_BUCKET, Key:f.key, ResponseContentDisposition:`attachment; filename="${f.originalName.replace(/"/g,'') }"` });
    const url = await getSignedUrl(getS3(), cmd, { expiresIn: 900 });
    res.json({ ok:true, downloadUrl:url, file:publicFile(f) });
  }catch(err){ res.status(500).json({ ok:false, error:err.message }); }
});

app.get('/api/delete-url/:id', async (req,res)=>{
  try{
    const email = requireEmail(req,res); if(!email) return;
    const f = loadDb().files.find(x=>x.id===req.params.id && x.email===email && !x.deleted);
    if(!f) return res.status(404).json({ ok:false, error:'Filen blev ikke fundet.' });
    if(f.storageDriver !== 'r2') return res.status(400).json({ ok:false, error:'Direkte sletning kun for R2.' });
    const url = await getSignedUrl(getS3(), new DeleteObjectCommand({ Bucket:R2_BUCKET, Key:f.key }), { expiresIn: 900 });
    res.json({ ok:true, deleteUrl:url, method:'DELETE' });
  }catch(err){ res.status(500).json({ ok:false, error:err.message }); }
});

app.delete('/api/files/:id', async (req,res)=>{
  const email = requireEmail(req,res); if(!email) return;
  const db=loadDb();
  const f = db.files.find(x=>x.id===req.params.id && x.email===email && !x.deleted);
  if(!f) return res.status(404).json({ ok:false, error:'Filen blev ikke fundet.' });
  f.deleted=true; f.deletedAt=new Date().toISOString(); saveDb(db);
  res.json({ ok:true, deleted:true, note:'Metadata er slettet. I R2 mode bruges browser direkte delete-url for fysisk sletning.' });
});

app.get('/api/r2-test', async (req,res)=>{
  try{
    if(!R2_READY) return res.status(500).json({ ok:false, error:'R2 ikke klar.' });
    const key = `tests/server-sign-${Date.now()}.txt`;
    const putUrl = await getSignedUrl(getS3(), new PutObjectCommand({ Bucket:R2_BUCKET, Key:key, ContentType:'text/plain' }), { expiresIn:900 });
    const getUrl = await getSignedUrl(getS3(), new GetObjectCommand({ Bucket:R2_BUCKET, Key:key }), { expiresIn:900 });
    const delUrl = await getSignedUrl(getS3(), new DeleteObjectCommand({ Bucket:R2_BUCKET, Key:key }), { expiresIn:900 });
    res.json({ ok:true, mode:'signed-url-only', message:'R2 signering virker. Test upload sker fra browser direkte til R2.', key, putUrlCreated:!!putUrl, getUrlCreated:!!getUrl, deleteUrlCreated:!!delUrl });
  }catch(err){ res.status(500).json({ ok:false, error:err.message }); }
});

app.listen(PORT, ()=> console.log(`3D Storage v${VERSION} running on ${PORT}`));
