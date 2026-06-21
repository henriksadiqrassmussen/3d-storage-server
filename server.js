const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mime = require('mime-types');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '0.5.4';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase().trim();
const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase().trim();
const R2_ACCOUNT_ID_RAW = (process.env.R2_ACCOUNT_ID || '').trim();
const R2_ACCOUNT_ID = R2_ACCOUNT_ID_RAW
  .replace(/^https?:\/\//i, '')
  .replace(/\.r2\.cloudflarestorage\.com\/?$/i, '')
  .replace(/\/$/, '')
  .trim();
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_ENDPOINT = R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '';
const r2Ready = Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
const INDEX_FILE = path.join(__dirname, 'data', 'files.json');
const LOCAL_UPLOAD_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });

function loadFiles() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); }
  catch { return []; }
}
function saveFiles(files) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(files, null, 2));
}
function safeEmail(email) {
  return String(email || '').toLowerCase().trim();
}
function safeName(name) {
  return String(name || 'file.bin').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 160);
}
function userForEmail(email) {
  const e = safeEmail(email);
  const owner = e === OWNER_EMAIL;
  const quotaBytes = owner ? 10 * 1024 ** 4 : 1 * 1024 ** 3;
  const files = loadFiles().filter(f => f.email === e && !f.deleted);
  const usedBytes = files.reduce((sum, f) => sum + Number(f.sizeBytes || 0), 0);
  return {
    email: e,
    plan: owner ? 'OWNER_FREE' : 'FREE_TEST',
    planName: owner ? 'Owner free' : 'Free test',
    quotaBytes,
    usedBytes,
    freeBytes: Math.max(0, quotaBytes - usedBytes),
    subscriptionStatus: owner ? 'owner_free' : 'free_test',
    priceEuroPerGb: 1
  };
}
function assertEmail(email) {
  const e = safeEmail(email);
  if (!e || !e.includes('@')) {
    const err = new Error('E-mail mangler eller er ugyldig.');
    err.status = 400;
    throw err;
  }
  return e;
}
function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });
}
function hardenSignedUrl(url) {
  let u = String(url || '').trim();
  if (u.startsWith('//')) u = `https:${u}`;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    storageDriver: STORAGE_DRIVER,
    r2Ready,
    pricing: '1GB=1EUR',
    node: process.version,
    r2EndpointHost: R2_ACCOUNT_ID ? `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null,
    r2Mode: 'signed-direct-upload-https-hardening',
    signedUrlHttpsFix: true,
    r2AccountIdLooksLikeEndpoint: /https?:\/\//i.test(R2_ACCOUNT_ID_RAW)
  });
});

app.get('/api/me', (req, res) => {
  try { res.json({ ok: true, user: userForEmail(assertEmail(req.query.email)) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

app.get('/api/files', (req, res) => {
  try {
    const email = assertEmail(req.query.email);
    const files = loadFiles()
      .filter(f => f.email === email && !f.deleted)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, files });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

app.post('/api/upload-url', async (req, res) => {
  try {
    if (STORAGE_DRIVER !== 'r2' || !r2Ready) throw new Error('R2 er ikke klar. Tjek Railway variables.');
    const email = assertEmail(req.body.email);
    const originalName = safeName(req.body.fileName || 'upload.bin');
    const sizeBytes = Number(req.body.sizeBytes || 0);
    if (!sizeBytes || sizeBytes < 1) throw new Error('Filstørrelse mangler.');
    const user = userForEmail(email);
    if (user.usedBytes + sizeBytes > user.quotaBytes) {
      return res.status(413).json({ ok: false, error: 'Du har ikke nok ledig lagerplads.' });
    }
    const id = crypto.randomUUID();
    const key = `users/${encodeURIComponent(email)}/${Date.now()}_${id}_${originalName}`;

    // IMPORTANT: Do not sign ContentType here. Browser uploads FBX/GLB with inconsistent MIME types.
    const command = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key });
    const rawSignedUrl = await getSignedUrl(r2Client(), command, { expiresIn: 900 });
    const uploadUrl = hardenSignedUrl(rawSignedUrl);

    res.json({
      ok: true,
      id,
      key,
      uploadUrl,
      uploadUrlPreview: uploadUrl.slice(0, 80) + '...',
      uploadUrlStartsWithHttps: uploadUrl.startsWith('https://'),
      method: 'PUT',
      headers: {},
      note: 'Upload direkte med PUT uden Content-Type header for at undgå SignatureDoesNotMatch.'
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/complete-upload', (req, res) => {
  try {
    const email = assertEmail(req.body.email);
    const originalName = safeName(req.body.fileName || 'upload.bin');
    const sizeBytes = Number(req.body.sizeBytes || 0);
    const key = String(req.body.key || '').trim();
    if (!key) throw new Error('Storage key mangler.');
    const files = loadFiles();
    const existing = files.find(f => f.key === key && f.email === email && !f.deleted);
    if (!existing) {
      files.push({
        id: crypto.randomUUID(),
        email,
        originalName,
        key,
        sizeBytes,
        type: req.body.type || mime.lookup(originalName) || 'application/octet-stream',
        extension: path.extname(originalName).toLowerCase(),
        storageDriver: 'r2',
        createdAt: new Date().toISOString(),
        downloadCount: 0,
        deleted: false
      });
      saveFiles(files);
    }
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

app.get('/api/download-url/:id', async (req, res) => {
  try {
    const email = assertEmail(req.query.email);
    const file = loadFiles().find(f => f.id === req.params.id && f.email === email && !f.deleted);
    if (!file) return res.status(404).json({ ok: false, error: 'Filen blev ikke fundet.' });
    const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: file.key });
    const url = hardenSignedUrl(await getSignedUrl(r2Client(), command, { expiresIn: 900 }));
    res.json({ ok: true, url, file });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/download/:id', async (req, res) => {
  try {
    const email = assertEmail(req.query.email);
    const file = loadFiles().find(f => f.id === req.params.id && f.email === email && !f.deleted);
    if (!file) return res.status(404).send('Filen blev ikke fundet.');
    const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: file.key });
    const url = hardenSignedUrl(await getSignedUrl(r2Client(), command, { expiresIn: 900 }));
    res.redirect(url);
  } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/delete-url/:id', async (req, res) => {
  try {
    const email = assertEmail(req.query.email);
    const file = loadFiles().find(f => f.id === req.params.id && f.email === email && !f.deleted);
    if (!file) return res.status(404).json({ ok: false, error: 'Filen blev ikke fundet.' });
    const command = new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: file.key });
    const url = hardenSignedUrl(await getSignedUrl(r2Client(), command, { expiresIn: 900 }));
    res.json({ ok: true, url, file });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/complete-delete/:id', (req, res) => {
  try {
    const email = assertEmail(req.body.email);
    const files = loadFiles();
    const file = files.find(f => f.id === req.params.id && f.email === email && !f.deleted);
    if (!file) return res.status(404).json({ ok: false, error: 'Filen blev ikke fundet.' });
    file.deleted = true;
    file.deletedAt = new Date().toISOString();
    saveFiles(files);
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
});

app.get('/api/r2-test', async (req, res) => {
  try {
    if (STORAGE_DRIVER !== 'r2' || !r2Ready) throw new Error('R2 er ikke klar.');
    const key = `tests/r2-test-${Date.now()}.txt`;
    const putUrl = hardenSignedUrl(await getSignedUrl(r2Client(), new PutObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 900 }));
    res.json({
      ok: true,
      mode: 'signed-url-only',
      message: 'Server kan generere signed URL. Browser-upload tester selve PUT direkte.',
      putUrlStartsWithHttps: putUrl.startsWith('https://'),
      putUrlPreview: putUrl.slice(0, 100) + '...',
      endpointHost: `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: R2_BUCKET,
      node: process.version
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`3D Storage v${VERSION} running on ${PORT}`));
