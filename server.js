const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = '0.1.0';

const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

function safeName(name) {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 160);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    cb(null, `${stamp}__${safeName(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }
});

function fileInfo(filename) {
  const full = path.join(uploadsDir, filename);
  const stat = fs.statSync(full);
  return {
    name: filename,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    downloadUrl: `/files/${encodeURIComponent(filename)}`
  };
}

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="da">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>3D Storage Server</title>
  <style>
    body{font-family:Arial,sans-serif;background:#101319;color:#f3f4f6;margin:0;padding:32px}
    .card{max-width:760px;margin:auto;background:#181d27;border:1px solid #2c3445;border-radius:18px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
    h1{margin-top:0;color:#ff9f1c}.ok{color:#40d98b}code{background:#0b0e13;padding:4px 8px;border-radius:8px}.btn{display:inline-block;margin-top:12px;color:#111;background:#ff9f1c;padding:10px 14px;border-radius:10px;text-decoration:none;font-weight:bold}
  </style>
</head>
<body><div class="card">
  <h1>3D Storage Server</h1>
  <p class="ok">Serveren kører.</p>
  <p>Healthcheck: <code>/health</code></p>
  <p>Filliste API: <code>/api/files</code></p>
  <p>Upload API: <code>/api/upload</code></p>
  <a class="btn" href="/api/files">Se JSON filliste</a>
</div></body></html>`);
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: '3d-storage-server', version: APP_VERSION, time: new Date().toISOString() });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded. Use multipart field name: file' });
  res.json({
    ok: true,
    message: 'File uploaded',
    file: {
      originalName: req.file.originalname,
      storedName: req.file.filename,
      size: req.file.size,
      downloadUrl: `/files/${encodeURIComponent(req.file.filename)}`
    }
  });
});

app.get('/api/files', (req, res) => {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const files = fs.readdirSync(uploadsDir)
    .filter(name => fs.statSync(path.join(uploadsDir, name)).isFile())
    .map(fileInfo)
    .sort((a, b) => b.modified.localeCompare(a.modified));
  res.json({ ok: true, count: files.length, files });
});

app.get('/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const full = path.join(uploadsDir, name);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'File not found' });
  res.download(full, name);
});

app.delete('/api/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const full = path.join(uploadsDir, name);
  if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'File not found' });
  fs.unlinkSync(full);
  res.json({ ok: true, deleted: name });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: 'File too large. Max 250 MB in starter version.' });
  res.status(500).json({ ok: false, error: err.message || 'Server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`3D Storage server v${APP_VERSION}`);
  console.log(`Listening on port ${PORT}`);
  console.log(`Uploads dir: ${uploadsDir}`);
});
