const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand;
try {
  const s3 = require('@aws-sdk/client-s3');
  S3Client = s3.S3Client;
  PutObjectCommand = s3.PutObjectCommand;
  GetObjectCommand = s3.GetObjectCommand;
  DeleteObjectCommand = s3.DeleteObjectCommand;
} catch (_) {}

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = '0.2.0';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase();
const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase(); // local | r2

const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'db.json');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const PLANS = {
  FREE_TEST: { name: 'Free test', quotaBytes: 1 * 1024 ** 3, priceEuro: 0 },
  STARTER: { name: 'Starter', quotaBytes: 5 * 1024 ** 3, priceEuro: 3 },
  CREATOR: { name: 'Creator', quotaBytes: 25 * 1024 ** 3, priceEuro: 7 },
  STUDIO: { name: 'Studio', quotaBytes: 100 * 1024 ** 3, priceEuro: 15 },
  PRO: { name: 'Pro', quotaBytes: 500 * 1024 ** 3, priceEuro: 39 },
  OWNER_FREE: { name: 'Owner free', quotaBytes: 10 * 1024 ** 4, priceEuro: 0 } // 10 TB owner quota
};

function loadDb() {
  if (!fs.existsSync(dbFile)) {
    const initial = { users: {}, files: [] };
    fs.writeFileSync(dbFile, JSON.stringify(initial, null, 2));
  }
  return JSON.parse(fs.readFileSync(dbFile, 'utf8'));
}
function saveDb(db) { fs.writeFileSync(dbFile, JSON.stringify(db, null, 2)); }
function nowIso() { return new Date().toISOString(); }
function safeName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 160);
}
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function getEmail(req) {
  return normalizeEmail(req.headers['x-user-email'] || req.body?.email || req.query?.email || '');
}
function ensureUser(email) {
  if (!email || !email.includes('@')) throw new Error('Email mangler. Send X-User-Email header eller email-felt.');
  const db = loadDb();
  if (!db.users[email]) {
    const plan = email === OWNER_EMAIL ? 'OWNER_FREE' : 'FREE_TEST';
    db.users[email] = {
      id: crypto.createHash('sha1').update(email).digest('hex').slice(0, 16),
      email,
      plan,
      quotaBytes: PLANS[plan].quotaBytes,
      usedBytes: 0,
      stripeCustomerId: '',
      stripeSubscriptionId: '',
      subscriptionStatus: email === OWNER_EMAIL ? 'owner_free' : 'free_test',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    saveDb(db);
  }
  return db.users[email];
}
function userFiles(db, email) { return db.files.filter(f => f.userEmail === email && !f.deletedAt); }
function recalcUsage(db, email) {
  const total = userFiles(db, email).reduce((sum, f) => sum + Number(f.sizeBytes || 0), 0);
  if (db.users[email]) { db.users[email].usedBytes = total; db.users[email].updatedAt = nowIso(); }
  return total;
}
function publicUser(user) {
  return {
    email: user.email,
    plan: user.plan,
    planName: PLANS[user.plan]?.name || user.plan,
    quotaBytes: user.quotaBytes,
    usedBytes: user.usedBytes || 0,
    freeBytes: Math.max(0, Number(user.quotaBytes || 0) - Number(user.usedBytes || 0)),
    subscriptionStatus: user.subscriptionStatus
  };
}
function storageKeyFor(email, originalName) {
  const stamp = nowIso().replace(/[:.]/g, '-');
  const id = crypto.randomBytes(6).toString('hex');
  return `${safeName(email)}/${stamp}__${id}__${safeName(originalName)}`;
}

let s3Client = null;
function getS3() {
  if (STORAGE_DRIVER !== 'r2') return null;
  if (!S3Client) throw new Error('AWS SDK mangler. Kør npm install eller brug STORAGE_DRIVER=local.');
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ''
      }
    });
  }
  return s3Client;
}
function r2Bucket() {
  if (!process.env.R2_BUCKET) throw new Error('R2_BUCKET mangler i miljøvariabler.');
  return process.env.R2_BUCKET;
}
async function saveObject(storageKey, localTempPath, mimeType) {
  if (STORAGE_DRIVER === 'r2') {
    const body = fs.createReadStream(localTempPath);
    await getS3().send(new PutObjectCommand({ Bucket: r2Bucket(), Key: storageKey, Body: body, ContentType: mimeType || 'application/octet-stream' }));
    fs.unlinkSync(localTempPath);
    return { driver: 'r2', storageKey };
  }
  const dest = path.join(uploadsDir, storageKey);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(localTempPath, dest);
  return { driver: 'local', storageKey };
}
async function streamObject(res, file) {
  if (file.storageDriver === 'r2') {
    const r = await getS3().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: file.storageKey }));
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    r.Body.pipe(res);
    return;
  }
  const full = path.join(uploadsDir, file.storageKey);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'File not found on local disk' });
  res.download(full, file.originalName || path.basename(file.storageKey));
}
async function deleteObject(file) {
  if (file.storageDriver === 'r2') {
    await getS3().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: file.storageKey }));
  } else {
    const full = path.join(uploadsDir, file.storageKey);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}

const tempStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `.tmp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}__${safeName(file.originalname)}`)
});
const upload = multer({ storage: tempStorage, limits: { fileSize: 1024 * 1024 * 1024 } });

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>3D Storage v${APP_VERSION}</title><style>body{font-family:Arial;background:#101319;color:#f3f4f6;margin:0;padding:32px}.card{max-width:860px;margin:auto;background:#181d27;border:1px solid #2c3445;border-radius:18px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.35)}h1{color:#ff9f1c}.ok{color:#40d98b}code{background:#0b0e13;padding:4px 8px;border-radius:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{background:#0b0e13;padding:14px;border-radius:12px}</style></head><body><div class="card"><h1>3D Storage Server</h1><p class="ok">Serveren kører. Version ${APP_VERSION}</p><div class="grid"><div class="box"><b>Storage</b><br><code>${STORAGE_DRIVER}</code></div><div class="box"><b>Owner free</b><br><code>${OWNER_EMAIL}</code></div></div><p>Health: <code>/health</code></p><p>Login/status: <code>/api/me?email=${OWNER_EMAIL}</code></p><p>Filliste: <code>/api/files?email=${OWNER_EMAIL}</code></p></div></body></html>`);
});
app.get('/health', (req, res) => res.json({ ok: true, service: '3d-storage-server', version: APP_VERSION, storageDriver: STORAGE_DRIVER, ownerEmail: OWNER_EMAIL, time: nowIso() }));

app.get('/api/plans', (req, res) => res.json({ ok: true, plans: PLANS }));
app.get('/api/me', (req, res) => {
  try {
    const user = ensureUser(getEmail(req));
    const db = loadDb();
    recalcUsage(db, user.email); saveDb(db);
    res.json({ ok: true, user: publicUser(db.users[user.email]) });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const email = getEmail(req);
    const user = ensureUser(email);
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded. Use multipart field name: file' });
    const db = loadDb();
    recalcUsage(db, email);
    const current = Number(db.users[email].usedBytes || 0);
    const quota = Number(db.users[email].quotaBytes || 0);
    if (current + req.file.size > quota) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(403).json({ ok: false, error: 'Lagerkvote overskredet', usedBytes: current, quotaBytes: quota, uploadSize: req.file.size });
    }
    const storageKey = storageKeyFor(email, req.file.originalname);
    const saved = await saveObject(storageKey, req.file.path, req.file.mimetype);
    const record = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      userEmail: email,
      originalName: req.file.originalname,
      name: path.basename(storageKey),
      storageKey: saved.storageKey,
      storageDriver: saved.driver,
      sizeBytes: req.file.size,
      size: req.file.size,
      mimeType: req.file.mimetype || 'application/octet-stream',
      extension: path.extname(req.file.originalname || '').toLowerCase(),
      createdAt: nowIso(),
      modified: nowIso(),
      downloadCount: 0
    };
    db.files.push(record);
    recalcUsage(db, email); saveDb(db);
    res.json({ ok: true, message: 'File uploaded', user: publicUser(db.users[email]), file: { ...record, downloadUrl: `/files/${encodeURIComponent(record.id)}` } });
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ ok: false, error: e.message || 'Upload error' });
  }
});

app.get('/api/files', (req, res) => {
  try {
    const email = getEmail(req);
    const user = ensureUser(email);
    const db = loadDb();
    recalcUsage(db, email); saveDb(db);
    const files = userFiles(db, email).map(f => ({
      id: f.id,
      name: f.originalName || f.name,
      originalName: f.originalName,
      storedName: f.name,
      storageDriver: f.storageDriver,
      size: f.sizeBytes,
      sizeBytes: f.sizeBytes,
      mimeType: f.mimeType,
      extension: f.extension,
      modified: f.createdAt,
      createdAt: f.createdAt,
      downloadCount: f.downloadCount || 0,
      downloadUrl: `/files/${encodeURIComponent(f.id)}`
    })).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ ok: true, user: publicUser(db.users[email]), count: files.length, files });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.get('/files/:id', async (req, res) => {
  try {
    const email = getEmail(req);
    ensureUser(email);
    const db = loadDb();
    const file = db.files.find(f => f.id === req.params.id && f.userEmail === email && !f.deletedAt);
    if (!file) return res.status(404).json({ ok: false, error: 'File not found for this user' });
    file.downloadCount = Number(file.downloadCount || 0) + 1; saveDb(db);
    await streamObject(res, file);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.delete('/api/files/:id', async (req, res) => {
  try {
    const email = getEmail(req);
    ensureUser(email);
    const db = loadDb();
    const file = db.files.find(f => f.id === req.params.id && f.userEmail === email && !f.deletedAt);
    if (!file) return res.status(404).json({ ok: false, error: 'File not found for this user' });
    await deleteObject(file);
    file.deletedAt = nowIso();
    recalcUsage(db, email); saveDb(db);
    res.json({ ok: true, deleted: file.id, user: publicUser(db.users[email]) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: 'File too large. Max 1 GB in v0.2.1 starter.' });
  res.status(500).json({ ok: false, error: err.message || 'Server error' });
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`3D Storage server v${APP_VERSION}`);
  console.log(`Listening on port ${PORT}`);
  console.log(`Storage driver: ${STORAGE_DRIVER}`);
  console.log(`Owner free account: ${OWNER_EMAIL}`);
  console.log(`Uploads dir: ${uploadsDir}`);
});
