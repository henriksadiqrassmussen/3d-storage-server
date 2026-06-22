const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Stripe = require('stripe');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
const VERSION = '0.7.0';

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vault1973@gmail.com').toLowerCase().trim();
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'r2-worker';
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET || '';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const PLANS = {
  '1gb': { id:'1gb', gb:1, eur:1, name:'3D Storage 1 GB' },
  '5gb': { id:'5gb', gb:5, eur:5, name:'3D Storage 5 GB' },
  '25gb': { id:'25gb', gb:25, eur:25, name:'3D Storage 25 GB' },
  '100gb': { id:'100gb', gb:100, eur:100, name:'3D Storage 100 GB' }
};

app.use(cors());

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(500).send('Stripe webhook is not configured');
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = cleanEmail((session.metadata && session.metadata.email) || session.customer_email);
      const planId = session.metadata && session.metadata.planId;
      const plan = PLANS[planId];
      if (email && plan) {
        setSubscription(email, {
          plan: `PAID_${plan.gb}GB`,
          planName: `${plan.gb} GB`,
          quotaBytes: plan.gb * 1024 ** 3,
          subscriptionStatus: 'active',
          priceEuro: plan.eur,
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : '',
          stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : '',
          stripeSessionId: session.id,
          updatedAt: Date.now()
        });
      }
    }
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      cancelSubscriptionByStripeSubId(sub.id);
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
    res.status(500).send('Webhook handler failed');
  }
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const dbPath = path.join(__dirname, 'data.json');
function readDb(){
  try { const data = JSON.parse(fs.readFileSync(dbPath, 'utf8')); data.files = Array.isArray(data.files) ? data.files : []; data.subscriptions = Array.isArray(data.subscriptions) ? data.subscriptions : []; return data; }
  catch { return { files: [], subscriptions: [] }; }
}
function writeDb(db){ fs.writeFileSync(dbPath, JSON.stringify(db, null, 2)); }
function cleanEmail(email){ return String(email || '').toLowerCase().trim(); }
function safeName(name){ return String(name || 'file.bin').replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120); }
function getSubscription(email){ return readDb().subscriptions.find(s => cleanEmail(s.email) === cleanEmail(email) && s.subscriptionStatus === 'active') || null; }
function setSubscription(email, sub){ const db = readDb(); const clean = cleanEmail(email); const idx = db.subscriptions.findIndex(s => cleanEmail(s.email) === clean); const row = { email: clean, ...sub }; if (idx >= 0) db.subscriptions[idx] = { ...db.subscriptions[idx], ...row }; else db.subscriptions.push(row); writeDb(db); }
function cancelSubscriptionByStripeSubId(stripeSubscriptionId){ const db = readDb(); let changed = false; db.subscriptions = db.subscriptions.map(s => { if (s.stripeSubscriptionId === stripeSubscriptionId) { changed = true; return { ...s, subscriptionStatus:'cancelled', updatedAt:Date.now() }; } return s; }); if (changed) writeDb(db); }
function planFor(email){ const clean = cleanEmail(email); if (clean === OWNER_EMAIL) return { plan:'OWNER_FREE', planName:'Owner free', quotaBytes: 10 * 1024 ** 4, subscriptionStatus:'owner_free', priceEuro:0 }; const sub = getSubscription(clean); if (sub) return { plan:sub.plan, planName:sub.planName, quotaBytes:sub.quotaBytes, subscriptionStatus:sub.subscriptionStatus, priceEuro:sub.priceEuro, stripeCustomerId:sub.stripeCustomerId || '', stripeSubscriptionId:sub.stripeSubscriptionId || '' }; return { plan:'NO_PLAN', planName:'No active plan', quotaBytes: 0, subscriptionStatus:'none', priceEuro:0 }; }
function userFiles(email){ return readDb().files.filter(f => cleanEmail(f.email) === cleanEmail(email)); }
function usedBytes(email){ return userFiles(email).reduce((sum, f) => sum + (Number(f.sizeBytes)||0), 0); }
function userInfo(email){ const p = planFor(email); const used = usedBytes(email); return { email: cleanEmail(email), ...p, usedBytes: used, freeBytes: Math.max(0, p.quotaBytes - used) }; }
function workerHeaders(){ return { 'x-worker-secret': WORKER_SHARED_SECRET }; }
async function workerFetch(url, opts={}){ return fetch(url, { ...opts, headers: { ...(opts.headers||{}), ...workerHeaders() } }); }
function publicBaseUrl(req){ const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https'; return `${proto}://${req.get('host')}`; }

app.get('/', (req,res)=> res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', async (req,res)=>{ let workerPing = false; if (WORKER_URL && WORKER_SHARED_SECRET) { try { const r = await fetch(WORKER_URL + '/health'); const j = await r.json(); workerPing = !!j.ok && !!j.bucketReady; } catch {} } res.json({ ok:true, version:VERSION, storageDriver:STORAGE_DRIVER, pricing:'1GB=1EUR', node:process.version, r2Mode:'railway-worker-proxy-stripe-login-ready', workerReady: !!(WORKER_URL && WORKER_SHARED_SECRET && workerPing), workerUrlSet: !!WORKER_URL, workerSecretSet: !!WORKER_SHARED_SECRET, workerPing, stripeReady: !!STRIPE_SECRET_KEY, stripeWebhookReady: !!STRIPE_WEBHOOK_SECRET, ui:'stripe-login-ready' }); });
app.get('/api/plans', (req,res)=> res.json({ ok:true, plans:Object.values(PLANS), stripeReady: !!stripe }));
app.get('/api/me', (req,res)=>{ const email = cleanEmail(req.query.email); if(!email) return res.status(400).json({ok:false,error:'E-mail mangler'}); res.json({ok:true,user:userInfo(email)}); });
app.get('/api/files', (req,res)=>{ const email = cleanEmail(req.query.email); if(!email) return res.status(400).json({ok:false,error:'E-mail mangler'}); res.json({ok:true,files:userFiles(email).sort((a,b)=>b.createdAt-a.createdAt)}); });
app.post('/api/stripe/create-checkout-session', async (req,res)=>{ try { if (!stripe) return res.status(500).json({ ok:false, error:'Stripe mangler STRIPE_SECRET_KEY i Railway Variables' }); const email = cleanEmail(req.body.email); const planId = String(req.body.planId || '').toLowerCase(); const plan = PLANS[planId]; if (!email) return res.status(400).json({ ok:false, error:'E-mail mangler' }); if (!plan) return res.status(400).json({ ok:false, error:'Ugyldig lagerpakke' }); if (email === OWNER_EMAIL) return res.status(400).json({ ok:false, error:'Ejerkontoen er allerede gratis/aktiv' }); const base = publicBaseUrl(req); const session = await stripe.checkout.sessions.create({ mode:'subscription', customer_email:email, line_items:[{ quantity:1, price_data:{ currency:'eur', unit_amount:plan.eur * 100, recurring:{ interval:'month' }, product_data:{ name:plan.name, description:`${plan.gb} GB cloud storage for 3D files` } } }], metadata:{ email, planId, gb:String(plan.gb) }, subscription_data:{ metadata:{ email, planId, gb:String(plan.gb) } }, success_url:`${base}/?stripe=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url:`${base}/?stripe=cancelled` }); res.json({ ok:true, url:session.url }); } catch(e) { console.error(e); res.status(500).json({ ok:false, error:e.message }); } });
app.post('/api/upload', upload.single('file'), async (req,res)=>{ try { const email = cleanEmail(req.body.email); if(!email) return res.status(400).json({ok:false,error:'E-mail mangler'}); if(!req.file) return res.status(400).json({ok:false,error:'Fil mangler'}); const u = userInfo(email); if (u.quotaBytes <= 0) return res.status(403).json({ok:false,error:'Vælg en lagerpakke før upload'}); if (req.file.size > u.freeBytes) return res.status(403).json({ok:false,error:'Du har ikke nok ledig lagerplads'}); if (STORAGE_DRIVER !== 'r2-worker' || !WORKER_URL || !WORKER_SHARED_SECRET) return res.status(500).json({ok:false,error:'Worker/R2 er ikke klar'}); const id = crypto.randomUUID(); const originalName = safeName(req.file.originalname); const key = `users/${encodeURIComponent(email)}/${Date.now()}_${id}_${originalName}`; const url = `${WORKER_URL}/upload?key=${encodeURIComponent(key)}`; const wr = await workerFetch(url, { method:'PUT', body:req.file.buffer, headers:{ 'content-type': req.file.mimetype || 'application/octet-stream' } }); if(!wr.ok){ const t = await wr.text(); return res.status(wr.status).json({ok:false,error:`Worker upload HTTP ${wr.status}: ${t}`}); } const file = { id, email, originalName, storageKey:key, sizeBytes:req.file.size, mimeType:req.file.mimetype || 'application/octet-stream', extension:path.extname(originalName).toLowerCase(), createdAt:Date.now(), downloadCount:0 }; const db = readDb(); db.files.push(file); writeDb(db); res.json({ok:true,file,user:userInfo(email)}); } catch(e){ res.status(500).json({ok:false,error:e.message}); } });
app.get('/api/download/:id', async (req,res)=>{ const email = cleanEmail(req.query.email); const db = readDb(); const file = db.files.find(f=>f.id===req.params.id && cleanEmail(f.email)===email); if(!file) return res.status(404).send('File not found'); const wr = await workerFetch(`${WORKER_URL}/download?key=${encodeURIComponent(file.storageKey)}`); if(!wr.ok) return res.status(wr.status).send(await wr.text()); file.downloadCount = (file.downloadCount||0)+1; writeDb(db); res.setHeader('Content-Type', file.mimeType || 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`); const arr = Buffer.from(await wr.arrayBuffer()); res.send(arr); });
app.delete('/api/files/:id', async (req,res)=>{ const email = cleanEmail(req.query.email); const db = readDb(); const idx = db.files.findIndex(f=>f.id===req.params.id && cleanEmail(f.email)===email); if(idx<0) return res.status(404).json({ok:false,error:'Filen blev ikke fundet'}); const file = db.files[idx]; const wr = await workerFetch(`${WORKER_URL}/delete?key=${encodeURIComponent(file.storageKey)}`, { method:'DELETE' }); if(!wr.ok) return res.status(wr.status).json({ok:false,error:await wr.text()}); db.files.splice(idx,1); writeDb(db); res.json({ok:true,user:userInfo(email)}); });
app.get('/api/download-status',(req,res)=>{ const downloads = path.join(__dirname,'public','downloads'); const apk = fs.existsSync(path.join(downloads,'3d-storage-android.apk')); const pc = fs.existsSync(path.join(downloads,'3D_Storage_PC_Companion.zip')); res.json({ok:true,apk,pc}); });
app.listen(PORT, ()=> console.log(`3D Storage v${VERSION} running on ${PORT}`));
