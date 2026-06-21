const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = '0.4.3';
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'local';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase();
const uploadDir = path.join(__dirname, 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public', 'downloads'), { recursive: true });

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: 0 }));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});
const upload = multer({ storage });

function bytesToHuman(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
function getFiles(email) {
  if (!fs.existsSync(uploadDir)) return [];
  return fs.readdirSync(uploadDir).map(name => {
    const full = path.join(uploadDir, name);
    const stat = fs.statSync(full);
    return {
      id: encodeURIComponent(name),
      name,
      originalName: name.replace(/^\d+_/, ''),
      sizeBytes: stat.size,
      sizeHuman: bytesToHuman(stat.size),
      createdAt: stat.birthtime,
      url: `/api/download/${encodeURIComponent(name)}?email=${encodeURIComponent(email || '')}`
    };
  }).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function getUsedBytes(email) {
  return getFiles(email).reduce((sum, f) => sum + f.sizeBytes, 0);
}
function getUser(emailRaw) {
  const email = String(emailRaw || '').trim().toLowerCase();
  const isOwner = email === OWNER_EMAIL;
  const quotaBytes = isOwner ? 10995116277760 : 1073741824;
  const usedBytes = getUsedBytes(email);
  return {
    email,
    plan: isOwner ? 'OWNER_FREE' : 'FREE_TEST',
    planName: isOwner ? 'Owner free' : 'Free test',
    quotaBytes,
    usedBytes,
    freeBytes: Math.max(0, quotaBytes - usedBytes),
    subscriptionStatus: isOwner ? 'owner_free' : 'free_test'
  };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/health', (req, res) => {
  res.json({ ok: true, version: VERSION, storageDriver: STORAGE_DRIVER });
});
app.get('/api/me', (req, res) => {
  const user = getUser(req.query.email);
  if (!user.email) return res.status(400).json({ ok: false, error: 'E-mail mangler.' });
  res.json({ ok: true, user });
});
app.get('/api/files', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, error: 'E-mail mangler.' });
  res.json({ ok: true, files: getFiles(email) });
});
app.post('/api/upload', upload.single('file'), (req, res) => {
  const email = String(req.body.email || req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, error: 'E-mail mangler.' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'Fil mangler.' });
  const user = getUser(email);
  if (req.file.size > user.freeBytes + req.file.size) {
    return res.status(403).json({ ok: false, error: 'Du har ikke nok lagerplads.' });
  }
  res.json({ ok: true, message: 'Upload færdig.', file: { id: encodeURIComponent(req.file.filename), name: req.file.filename, sizeBytes: req.file.size }, user: getUser(email) });
});
app.get('/api/download/:id', (req, res) => {
  const name = decodeURIComponent(req.params.id);
  const full = path.join(uploadDir, path.basename(name));
  if (!fs.existsSync(full)) return res.status(404).send('Filen findes ikke.');
  res.download(full, name.replace(/^\d+_/, ''));
});
app.delete('/api/files/:id', (req, res) => {
  const name = decodeURIComponent(req.params.id);
  const full = path.join(uploadDir, path.basename(name));
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'Filen findes ikke.' });
  fs.unlinkSync(full);
  res.json({ ok: true, message: 'Fil slettet.' });
});
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'API endpoint findes ikke.' });
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`3D Storage v${VERSION} kører på port ${PORT}`));
