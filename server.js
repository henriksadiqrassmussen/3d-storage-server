const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = '0.5.0';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase().trim();
const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase().trim();
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const META_FILE = path.join(__dirname, 'data_files.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

const PLANS = {
  OWNER_FREE: { planName: 'Owner free', quotaBytes: 10 * 1024 ** 4, priceEuro: 0, subscriptionStatus: 'owner_free' },
  FREE_TEST: { planName: 'Free test', quotaBytes: 1 * 1024 ** 3, priceEuro: 0, subscriptionStatus: 'free_test' },
  STARTER: { planName: 'Starter', quotaBytes: 5 * 1024 ** 3, priceEuro: 3, subscriptionStatus: 'active' },
  CREATOR: { planName: 'Creator', quotaBytes: 25 * 1024 ** 3, priceEuro: 7, subscriptionStatus: 'active' },
  STUDIO: { planName: 'Studio', quotaBytes: 100 * 1024 ** 3, priceEuro: 15, subscriptionStatus: 'active' }
};

function safeEmail(email) { return String(email || '').toLowerCase().trim(); }
function getUserPlan(email) { return safeEmail(email) === OWNER_EMAIL ? 'OWNER_FREE' : 'FREE_TEST'; }
function fileExt(name) { return (path.extname(name || '').replace('.', '').toLowerCase() || 'bin'); }
function allowedFile(name) { return ['fbx','glb','gltf','zip','obj','blend'].includes(fileExt(name)); }
function nowIso() { return new Date().toISOString(); }
function loadMeta() { try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return []; } }
function saveMeta(rows) { fs.writeFileSync(META_FILE, JSON.stringify(rows, null, 2)); }
function publicBase(req) { return `${req.protocol}://${req.get('host')}`; }
function makeKey(email, originalName) {
  const ext = path.extname(originalName || '.bin');
  const stamp = Date.now();
  const rnd = crypto.randomBytes(6).toString('hex');
  return `${safeEmail(email).replace(/[^a-z0-9@._-]/g,'_')}/${stamp}_${rnd}${ext}`;
}

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  });
}
function r2Ready() { return !!(getR2Client() && process.env.R2_BUCKET); }

async function listFiles(email, req) {
  const all = loadMeta().filter(f => safeEmail(f.email) === safeEmail(email));
  return all.map(f => ({
    ...f,
    url: `${publicBase(req)}/api/download/${encodeURIComponent(f.id)}?email=${encodeURIComponent(email)}`
  })).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
async function usedBytes(email) {
  return loadMeta().filter(f => safeEmail(f.email) === safeEmail(email)).reduce((sum, f) => sum + Number(f.sizeBytes || 0), 0);
}
async function putFile({ email, originalName, buffer, mimeType }) {
  const id = crypto.randomUUID();
  const key = makeKey(email, originalName);
  const record = { id, email: safeEmail(email), originalName, storageKey: key, sizeBytes: buffer.length, mimeType: mimeType || 'application/octet-stream', extension: fileExt(originalName), storageDriver: STORAGE_DRIVER, createdAt: nowIso(), downloadCount: 0 };
  if (STORAGE_DRIVER === 'r2') {
    if (!r2Ready()) throw new Error('R2 er valgt, men R2 variables mangler. Sæt R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY og R2_BUCKET.');
    await getR2Client().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: buffer, ContentType: record.mimeType }));
  } else {
    const full = path.join(UPLOAD_DIR, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
  }
  const meta = loadMeta(); meta.push(record); saveMeta(meta);
  return record;
}
async function deleteFile(record) {
  if (record.storageDriver === 'r2' || STORAGE_DRIVER === 'r2') {
    if (r2Ready()) await getR2Client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: record.storageKey }));
  } else {
    const full = path.join(UPLOAD_DIR, record.storageKey);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}
async function downloadUrlOrStream(record, res) {
  if (record.storageDriver === 'r2' || STORAGE_DRIVER === 'r2') {
    if (!r2Ready()) throw new Error('R2 variables mangler.');
    const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: record.storageKey, ResponseContentDisposition: `attachment; filename="${record.originalName}"` });
    const signed = await getSignedUrl(getR2Client(), cmd, { expiresIn: 60 * 10 });
    return res.redirect(signed);
  }
  const full = path.join(UPLOAD_DIR, record.storageKey);
  if (!fs.existsSync(full)) return res.status(404).json({ ok:false, error:'Filen findes ikke lokalt. Ved Railway redeploy kan local-filer forsvinde. Brug R2 for permanent storage.' });
  return res.download(full, record.originalName);
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.json({ ok:true, version: VERSION, storageDriver: STORAGE_DRIVER, r2Ready: r2Ready() }));
app.get('/api/me', async (req, res) => {
  const email = safeEmail(req.query.email);
  if (!email) return res.status(400).json({ ok:false, error:'E-mail mangler.' });
  const plan = getUserPlan(email); const p = PLANS[plan]; const used = await usedBytes(email);
  res.json({ ok:true, user: { email, plan, planName:p.planName, priceEuro:p.priceEuro, quotaBytes:p.quotaBytes, usedBytes:used, freeBytes:Math.max(0, p.quotaBytes-used), subscriptionStatus:p.subscriptionStatus } });
});
app.get('/api/files', async (req, res) => {
  const email = safeEmail(req.query.email);
  if (!email) return res.status(400).json({ ok:false, error:'E-mail mangler.' });
  res.json({ ok:true, files: await listFiles(email, req) });
});
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const email = safeEmail(req.body.email || req.query.email);
    if (!email) return res.status(400).json({ ok:false, error:'E-mail mangler.' });
    if (!req.file) return res.status(400).json({ ok:false, error:'Fil mangler.' });
    if (!allowedFile(req.file.originalname)) return res.status(400).json({ ok:false, error:'Kun FBX, GLB, GLTF, ZIP, OBJ og BLEND er tilladt.' });
    const plan = PLANS[getUserPlan(email)];
    const used = await usedBytes(email);
    if (used + req.file.size > plan.quotaBytes) return res.status(403).json({ ok:false, error:'Du har ikke nok ledig lagerplads.', usedBytes: used, quotaBytes: plan.quotaBytes });
    const record = await putFile({ email, originalName: req.file.originalname, buffer: req.file.buffer, mimeType: req.file.mimetype });
    res.json({ ok:true, message:'Upload færdig.', file: record, usedBytes: used + req.file.size, quotaBytes: plan.quotaBytes });
  } catch (err) { res.status(500).json({ ok:false, error: err.message || 'Upload fejlede.' }); }
});
app.get('/api/download/:id', async (req, res) => {
  try {
    const email = safeEmail(req.query.email); const id = req.params.id;
    const meta = loadMeta(); const record = meta.find(f => f.id === id && safeEmail(f.email) === email);
    if (!record) return res.status(404).json({ ok:false, error:'Fil ikke fundet.' });
    record.downloadCount = Number(record.downloadCount || 0) + 1; saveMeta(meta);
    await downloadUrlOrStream(record, res);
  } catch (err) { res.status(500).json({ ok:false, error: err.message || 'Download fejlede.' }); }
});
app.delete('/api/files/:id', async (req, res) => {
  try {
    const email = safeEmail(req.query.email || req.body.email); const id = req.params.id;
    const meta = loadMeta(); const idx = meta.findIndex(f => f.id === id && safeEmail(f.email) === email);
    if (idx < 0) return res.status(404).json({ ok:false, error:'Fil ikke fundet.' });
    const record = meta[idx]; await deleteFile(record); meta.splice(idx, 1); saveMeta(meta);
    res.json({ ok:true, message:'Filen er slettet.' });
  } catch (err) { res.status(500).json({ ok:false, error: err.message || 'Sletning fejlede.' }); }
});

app.listen(PORT, () => console.log(`3D Storage v${VERSION} running on port ${PORT} storage=${STORAGE_DRIVER}`));
