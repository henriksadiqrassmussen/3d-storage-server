const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
const VERSION = '0.6.0';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase();
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'r2-worker';
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/+$/, '');
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const PRICING = '1GB=1EUR';

const DATA_DIR = path.join(__dirname, 'data');
const META_FILE = path.join(DATA_DIR, 'files.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return []; }
}
function writeMeta(files) { fs.writeFileSync(META_FILE, JSON.stringify(files, null, 2)); }
function cleanEmail(email) { return String(email || '').toLowerCase().trim(); }
function userPlan(email) {
  const e = cleanEmail(email);
  if (e === OWNER_EMAIL) return { email: e, plan: 'OWNER_FREE', planName: 'Owner free', quotaBytes: 10 * 1024 ** 4, subscriptionStatus: 'owner_free', priceEuro: 0 };
  return { email: e, plan: 'FREE_TEST', planName: 'Free test', quotaBytes: 1024 ** 3, subscriptionStatus: 'free_test', priceEuro: 0 };
}
function usedBytes(email) {
  const e = cleanEmail(email);
  return readMeta().filter(f => f.email === e).reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
}
function safeName(name) { return String(name || 'file.bin').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180); }
function makeKey(email, filename) {
  const e = encodeURIComponent(cleanEmail(email));
  return `users/${e}/${Date.now()}_${crypto.randomUUID()}_${safeName(filename)}`;
}
function requireWorker() {
  if (STORAGE_DRIVER !== 'r2-worker') throw new Error('STORAGE_DRIVER skal være r2-worker');
  if (!WORKER_URL) throw new Error('WORKER_URL mangler');
  if (!WORKER_SHARED_SECRET) throw new Error('WORKER_SHARED_SECRET mangler');
}
async function workerFetch(pathname, options = {}) {
  requireWorker();
  const res = await fetch(`${WORKER_URL}${pathname}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'x-worker-secret': WORKER_SHARED_SECRET
    }
  });
  return res;
}
async function pingWorker() {
  if (!WORKER_URL || !WORKER_SHARED_SECRET) return false;
  try {
    const r = await fetch(`${WORKER_URL}/health`);
    const j = await r.json().catch(() => ({}));
    return !!j.ok && !!j.bucketReady && !!j.secretReady;
  } catch { return false; }
}

app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', async (req, res) => {
  const workerPing = await pingWorker();
  res.json({
    ok: true,
    version: VERSION,
    storageDriver: STORAGE_DRIVER,
    pricing: PRICING,
    node: process.version,
    r2Mode: 'railway-worker-proxy-secret-fixed',
    workerReady: !!(WORKER_URL && WORKER_SHARED_SECRET && workerPing),
    workerUrlSet: !!WORKER_URL,
    workerSecretSet: !!WORKER_SHARED_SECRET,
    workerPing,
    googleLoginReady: !!GOOGLE_CLIENT_ID,
    downloadsReady: true
  });
});

app.get('/api/google-config', (req, res) => {
  res.json({ ok: true, googleClientId: GOOGLE_CLIENT_ID || null, googleLoginReady: !!GOOGLE_CLIENT_ID });
});

app.post('/api/auth/google', async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) return res.status(400).json({ ok: false, error: 'GOOGLE_CLIENT_ID mangler i Railway Variables' });
    const token = req.body?.credential || req.body?.idToken;
    if (!token) return res.status(400).json({ ok: false, error: 'Google token mangler' });
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = cleanEmail(payload?.email);
    if (!email || !payload?.email_verified) return res.status(401).json({ ok: false, error: 'Google e-mail kunne ikke verificeres' });
    const plan = userPlan(email);
    const used = usedBytes(email);
    res.json({ ok: true, user: { ...plan, name: payload?.name || '', picture: payload?.picture || '', usedBytes: used, freeBytes: Math.max(0, plan.quotaBytes - used) } });
  } catch (e) {
    res.status(401).json({ ok: false, error: 'Google-login fejlede: ' + e.message });
  }
});

app.get('/api/downloads', (req, res) => {
  const downloadDir = path.join(__dirname, 'public', 'downloads');
  const apk = path.join(downloadDir, '3d-storage-android.apk');
  const pc = path.join(downloadDir, '3D_Storage_PC_Companion.zip');
  res.json({
    ok: true,
    downloads: [
      { type: 'android', label: 'Android APK', path: '/downloads/3d-storage-android.apk', exists: fs.existsSync(apk), fileName: '3d-storage-android.apk' },
      { type: 'pc', label: 'PC Companion', path: '/downloads/3D_Storage_PC_Companion.zip', exists: fs.existsSync(pc), fileName: '3D_Storage_PC_Companion.zip' }
    ]
  });
});

app.get('/api/me', (req, res) => {
  const email = cleanEmail(req.query.email);
  if (!email) return res.status(400).json({ ok: false, error: 'E-mail mangler' });
  const plan = userPlan(email);
  const used = usedBytes(email);
  res.json({ ok: true, user: { ...plan, usedBytes: used, freeBytes: Math.max(0, plan.quotaBytes - used) } });
});

app.get('/api/files', (req, res) => {
  const email = cleanEmail(req.query.email);
  if (!email) return res.status(400).json({ ok: false, error: 'E-mail mangler' });
  const files = readMeta().filter(f => f.email === email).sort((a,b)=>b.createdAt-a.createdAt);
  res.json({ ok: true, files });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    if (!email) return res.status(400).json({ ok: false, error: 'E-mail mangler' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'Fil mangler' });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!['.fbx','.glb','.gltf','.zip'].includes(ext)) return res.status(400).json({ ok: false, error: 'Kun FBX, GLB, GLTF og ZIP er tilladt' });
    const plan = userPlan(email);
    const used = usedBytes(email);
    if (used + req.file.size > plan.quotaBytes) return res.status(403).json({ ok: false, error: 'Du har ikke nok lagerplads' });
    const key = makeKey(email, req.file.originalname);
    const workerRes = await workerFetch(`/upload?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'content-type': req.file.mimetype || 'application/octet-stream' },
      body: req.file.buffer
    });
    const txt = await workerRes.text();
    if (!workerRes.ok) return res.status(workerRes.status).json({ ok: false, error: `Worker upload HTTP ${workerRes.status}: ${txt}` });
    const record = {
      id: crypto.randomUUID(), email, originalName: req.file.originalname, key,
      sizeBytes: req.file.size, mimeType: req.file.mimetype || 'application/octet-stream',
      createdAt: Date.now()
    };
    const files = readMeta(); files.push(record); writeMeta(files);
    res.json({ ok: true, file: record });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/download/:id', async (req, res) => {
  try {
    const email = cleanEmail(req.query.email);
    const file = readMeta().find(f => f.id === req.params.id && f.email === email);
    if (!file) return res.status(404).json({ ok: false, error: 'File not found' });
    const workerRes = await workerFetch(`/download?key=${encodeURIComponent(file.key)}`, { method: 'GET' });
    if (!workerRes.ok) return res.status(workerRes.status).send(await workerRes.text());
    res.setHeader('Content-Type', workerRes.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(file.originalName)}"`);
    const buf = Buffer.from(await workerRes.arrayBuffer());
    res.send(buf);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/files/:id', async (req, res) => {
  try {
    const email = cleanEmail(req.query.email);
    const files = readMeta();
    const idx = files.findIndex(f => f.id === req.params.id && f.email === email);
    if (idx < 0) return res.status(404).json({ ok: false, error: 'File not found' });
    const file = files[idx];
    const workerRes = await workerFetch(`/delete?key=${encodeURIComponent(file.key)}`, { method: 'DELETE' });
    if (!workerRes.ok) return res.status(workerRes.status).send(await workerRes.text());
    files.splice(idx, 1); writeMeta(files);
    res.json({ ok: true, deleted: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`3D Storage v${VERSION} on ${PORT}`));
