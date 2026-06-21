const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const VERSION = '0.5.5';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase();
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'r2-worker';
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET || '';

app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function gb(n){ return n * 1024 * 1024 * 1024; }
function cleanEmail(email){ return String(email || '').trim().toLowerCase(); }
function safeName(name){ return String(name || 'file.bin').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0,180); }
function userPlan(email){
  email = cleanEmail(email);
  if(email === OWNER_EMAIL){ return { email, plan:'OWNER_FREE', planName:'Owner free', quotaBytes: gb(10240), subscriptionStatus:'owner_free', priceEuro:0 }; }
  return { email, plan:'GB_1', planName:'1 GB', quotaBytes: gb(1), subscriptionStatus:'trial_or_unpaid', priceEuro:1 };
}
function sign(payload){ return crypto.createHmac('sha256', WORKER_SHARED_SECRET).update(payload).digest('hex'); }
function workerReady(){ return !!(WORKER_URL && WORKER_SHARED_SECRET); }
async function workerJson(route){
  if(!workerReady()) throw new Error('WORKER_URL eller WORKER_SHARED_SECRET mangler');
  const ts = Date.now().toString();
  const payload = `${route}|${ts}`;
  const sig = sign(payload);
  const res = await fetch(`${WORKER_URL}${route}`, { headers: { 'x-3ds-ts': ts, 'x-3ds-signature': sig } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { ok:false, error:text }; }
  if(!res.ok) throw new Error(data.error || `Worker HTTP ${res.status}`);
  return data;
}

app.get('/health', (req,res)=>{
  res.json({ ok:true, version:VERSION, storageDriver:STORAGE_DRIVER, pricing:'1GB=1EUR', node:process.version, r2Mode:'cloudflare-worker-r2-binding', workerReady:workerReady(), workerUrlSet:!!WORKER_URL });
});
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/api/me', async (req,res)=>{
  const email = cleanEmail(req.query.email);
  if(!email) return res.status(400).json({ ok:false, error:'E-mail mangler' });
  const plan = userPlan(email);
  let usedBytes = 0;
  try { const data = await workerJson(`/list?email=${encodeURIComponent(email)}`); usedBytes = data.usedBytes || 0; } catch(e) {}
  res.json({ ok:true, user:{...plan, usedBytes, freeBytes: Math.max(0, plan.quotaBytes-usedBytes)} });
});
app.get('/api/files', async (req,res)=>{
  const email = cleanEmail(req.query.email);
  if(!email) return res.status(400).json({ ok:false, error:'E-mail mangler' });
  try { const data = await workerJson(`/list?email=${encodeURIComponent(email)}`); res.json(data); }
  catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.post('/api/upload-start', async (req,res)=>{
  const email = cleanEmail(req.body.email);
  const fileName = safeName(req.body.fileName);
  const size = Number(req.body.size || 0);
  const type = String(req.body.type || 'application/octet-stream');
  if(!email) return res.status(400).json({ ok:false, error:'E-mail mangler' });
  if(!fileName) return res.status(400).json({ ok:false, error:'Filnavn mangler' });
  const plan = userPlan(email);
  let usedBytes = 0;
  try { const data = await workerJson(`/list?email=${encodeURIComponent(email)}`); usedBytes = data.usedBytes || 0; } catch(e) {}
  if(size > 0 && usedBytes + size > plan.quotaBytes) return res.status(403).json({ ok:false, error:'Du har ikke nok lagerplads' });
  if(!workerReady()) return res.status(500).json({ ok:false, error:'Worker er ikke sat op. Tilføj WORKER_URL og WORKER_SHARED_SECRET i Railway.' });
  const key = `users/${encodeURIComponent(email)}/${Date.now()}_${crypto.randomUUID()}_${fileName}`;
  const expires = Date.now() + 15 * 60 * 1000;
  const payload = `PUT|${key}|${email}|${size}|${expires}`;
  const token = sign(payload);
  const uploadUrl = `${WORKER_URL}/upload?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&size=${encodeURIComponent(size)}&expires=${expires}&token=${token}&name=${encodeURIComponent(fileName)}&type=${encodeURIComponent(type)}`;
  res.json({ ok:true, uploadUrl, key, fileName, expires });
});
app.get('/api/download', async (req,res)=>{
  const email = cleanEmail(req.query.email); const key = String(req.query.key || '');
  if(!email || !key) return res.status(400).json({ ok:false, error:'E-mail eller key mangler' });
  const expires = Date.now() + 10 * 60 * 1000;
  const token = sign(`GET|${key}|${email}|${expires}`);
  res.json({ ok:true, url:`${WORKER_URL}/download?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&expires=${expires}&token=${token}` });
});
app.delete('/api/delete', async (req,res)=>{
  const email = cleanEmail(req.query.email); const key = String(req.query.key || '');
  if(!email || !key) return res.status(400).json({ ok:false, error:'E-mail eller key mangler' });
  const route = `/delete?email=${encodeURIComponent(email)}&key=${encodeURIComponent(key)}`;
  try { const data = await workerJson(route); res.json(data); } catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.get('/api/worker-test', async (req,res)=>{
  try { const data = await workerJson('/health'); res.json({ ok:true, worker:data }); } catch(e){ res.status(500).json({ ok:false, error:e.message, hint:'Tjek WORKER_URL og WORKER_SHARED_SECRET i Railway og Worker.' }); }
});

app.listen(PORT, ()=> console.log(`3D Storage v${VERSION} on ${PORT}`));
