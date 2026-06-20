const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = '0.4.1';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase();
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'local';

const uploadsDir = path.join(__dirname, 'uploads');
const publicDir = path.join(__dirname, 'public');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(path.join(publicDir, 'downloads'), { recursive: true });

app.use(cors({ origin: true, credentials: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({ storage });

function getUser(email) {
  const clean = (email || '').toLowerCase().trim();
  const files = listFiles(clean);
  const usedBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  const isOwner = clean === OWNER_EMAIL;
  const quotaBytes = isOwner ? 10995116277760 : 1073741824;
  return {
    email: clean,
    plan: isOwner ? 'OWNER_FREE' : 'FREE_TEST',
    planName: isOwner ? 'Owner free' : 'Free test',
    quotaBytes,
    usedBytes,
    freeBytes: Math.max(0, quotaBytes - usedBytes),
    subscriptionStatus: isOwner ? 'owner_free' : 'free_test'
  };
}

function metaPath(fileName) { return path.join(uploadsDir, fileName + '.json'); }
function listFiles(email) {
  const clean = (email || '').toLowerCase().trim();
  return fs.readdirSync(uploadsDir)
    .filter(name => !name.endsWith('.json'))
    .map(name => {
      const fullPath = path.join(uploadsDir, name);
      const stat = fs.statSync(fullPath);
      let meta = {};
      const mp = metaPath(name);
      if (fs.existsSync(mp)) {
        try { meta = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch {}
      }
      return {
        id: name,
        originalName: meta.originalName || name.replace(/^\d+_/, ''),
        fileName: name,
        email: meta.email || '',
        sizeBytes: stat.size,
        createdAt: stat.birthtime,
        extension: path.extname(meta.originalName || name).toLowerCase().replace('.', '')
      };
    })
    .filter(f => !clean || f.email === clean || clean === OWNER_EMAIL);
}

app.get('/health', (req, res) => {
  res.json({ ok: true, version: VERSION, storageDriver: STORAGE_DRIVER });
});

app.get('/api/me', (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ ok: false, error: 'email_required' });
  res.json({ ok: true, user: getUser(email) });
});

app.get('/api/files', (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ ok: false, error: 'email_required' });
  res.json({ ok: true, files: listFiles(email) });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ ok: false, error: 'email_required' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'file_required' });
  const before = getUser(email);
  if (before.freeBytes < req.file.size) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(413).json({ ok: false, error: 'quota_exceeded', message: 'Du har ikke nok ledig lagerplads.' });
  }
  const meta = {
    email,
    originalName: req.file.originalname,
    fileName: req.file.filename,
    sizeBytes: req.file.size,
    uploadedAt: new Date().toISOString()
  };
  fs.writeFileSync(metaPath(req.file.filename), JSON.stringify(meta, null, 2));
  res.json({ ok: true, file: { id: req.file.filename, ...meta }, user: getUser(email) });
});

app.get('/api/download/:id', (req, res) => {
  const id = req.params.id;
  const fullPath = path.join(uploadsDir, id);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ ok: false, error: 'not_found' });
  let originalName = id;
  const mp = metaPath(id);
  if (fs.existsSync(mp)) {
    try { originalName = JSON.parse(fs.readFileSync(mp, 'utf8')).originalName || id; } catch {}
  }
  res.download(fullPath, originalName);
});

app.delete('/api/files/:id', (req, res) => {
  const id = req.params.id;
  const fullPath = path.join(uploadsDir, id);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ ok: false, error: 'not_found' });
  try { fs.unlinkSync(fullPath); } catch {}
  try { fs.unlinkSync(metaPath(id)); } catch {}
  res.json({ ok: true });
});

// IMPORTANT: root must show the website, not API text.
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`3D Storage Website v${VERSION} running on port ${PORT}`);
});
