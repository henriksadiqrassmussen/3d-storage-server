const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = '0.4.2';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase();
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'local';

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DOWNLOAD_DIR = path.join(PUBLIC_DIR, 'downloads');
const DB_FILE = path.join(ROOT, 'db.json');

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (_) {
    return { files: [] };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function bytesToHuman(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes || 0);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function getUser(emailRaw) {
  const email = String(emailRaw || '').trim().toLowerCase();
  const db = readDb();
  const usedBytes = db.files
    .filter(f => f.email === email)
    .reduce((sum, f) => sum + Number(f.sizeBytes || 0), 0);

  const isOwner = email === OWNER_EMAIL;
  const quotaBytes = isOwner ? 10 * 1024 ** 4 : 1 * 1024 ** 3;

  return {
    email,
    plan: isOwner ? 'OWNER_FREE' : 'FREE_TEST',
    planName: isOwner ? 'Owner free' : 'Free test',
    quotaBytes,
    usedBytes,
    freeBytes: Math.max(0, quotaBytes - usedBytes),
    quotaHuman: bytesToHuman(quotaBytes),
    usedHuman: bytesToHuman(usedBytes),
    freeHuman: bytesToHuman(Math.max(0, quotaBytes - usedBytes)),
    subscriptionStatus: isOwner ? 'owner_free' : 'free_test'
  };
}

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// IMPORTANT: serve static website assets before fallback routes.
app.use('/downloads', express.static(DOWNLOAD_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));
app.use(express.static(PUBLIC_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = ['.fbx', '.glb', '.gltf', '.zip', '.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    cb(ok ? null : new Error('Filtypen er ikke tilladt'), ok);
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: VERSION, storageDriver: STORAGE_DRIVER });
});

app.get('/api/me', (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ ok: false, error: 'email_missing' });
  res.json({ ok: true, user: getUser(email) });
});

app.get('/api/files', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, error: 'email_missing' });
  const db = readDb();
  const files = db.files
    .filter(f => f.email === email)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(f => ({ ...f, sizeHuman: bytesToHuman(f.sizeBytes), downloadUrl: `/api/download/${f.id}?email=${encodeURIComponent(email)}` }));
  res.json({ ok: true, files });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  const email = String(req.body.email || req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, error: 'email_missing' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'file_missing' });

  const userBefore = getUser(email);
  if (req.file.size > userBefore.freeBytes) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    return res.status(413).json({ ok: false, error: 'quota_exceeded', message: 'Du har ikke nok ledig lagerplads.' });
  }

  const db = readDb();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const fileRecord = {
    id,
    email,
    originalName: req.file.originalname,
    storedName: req.file.filename,
    sizeBytes: req.file.size,
    extension: path.extname(req.file.originalname).toLowerCase(),
    mimeType: req.file.mimetype || 'application/octet-stream',
    createdAt: new Date().toISOString()
  };
  db.files.push(fileRecord);
  writeDb(db);
  res.json({ ok: true, file: { ...fileRecord, sizeHuman: bytesToHuman(fileRecord.sizeBytes) }, user: getUser(email) });
});

app.get('/api/download/:id', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  const db = readDb();
  const file = db.files.find(f => f.id === req.params.id && f.email === email);
  if (!file) return res.status(404).send('File not found');
  const filePath = path.join(UPLOAD_DIR, file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing on server');
  res.download(filePath, file.originalName);
});

app.delete('/api/files/:id', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  const db = readDb();
  const index = db.files.findIndex(f => f.id === req.params.id && f.email === email);
  if (index === -1) return res.status(404).json({ ok: false, error: 'file_not_found' });
  const [file] = db.files.splice(index, 1);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, file.storedName)); } catch (_) {}
  writeDb(db);
  res.json({ ok: true, deleted: file.id, user: getUser(email) });
});

app.get('/api/downloads', (_req, res) => {
  res.json({
    ok: true,
    downloads: [
      { name: 'Android APK', url: '/downloads/3d-storage-android.apk' },
      { name: 'PC Companion', url: '/downloads/3D_Storage_PC_Companion.zip' }
    ]
  });
});

// ROOT HARD FIX: / must always serve the website.
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Browser-app fallback for simple routes, but keep API 404 clean.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'api_not_found' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`3D Storage Website v${VERSION} running on port ${PORT}`);
});
