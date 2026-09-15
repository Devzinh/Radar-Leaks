import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { MongoClient, ObjectId } from 'mongodb';
import { verifySignature, verifyPassword, createSession, validSession } from './security.js';
import { providers, scan } from './scanner.js';
import { GitHub } from './github.js';

const config = process.env;
const required = ['MONGODB_URI', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'FINGERPRINT_SECRET', 'GITHUB_APP_ID', 'GITHUB_INSTALLATION_ID', 'GITHUB_PRIVATE_KEY_PATH', 'GITHUB_WEBHOOK_SECRET', 'APP_ORIGIN'];
const missing = required.filter(key => !config[key]);
const configured = missing.length === 0;
if (config.NODE_ENV === 'production' && !configured) throw new Error(`Missing environment: ${missing.join(', ')}`);
if (configured && [config.SESSION_SECRET, config.FINGERPRINT_SECRET, config.GITHUB_WEBHOOK_SECRET].some(value => value.length < 32)) throw new Error('Secrets must contain at least 32 characters');
const app = express();
app.disable('x-powered-by');
app.use(helmet());
let db; let client; let working = false; let stopping = false;
const github = new GitHub(config);
let lastError = null; let lastScan = null;
if (configured) {
  client = new MongoClient(config.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect(); db = client.db();
  await Promise.all([
    db.collection('findings').createIndex({ repository: 1, commit: 1, path: 1, fingerprint: 1 }, { unique: true }),
    db.collection('jobs').createIndex({ repository: 1, sha: 1 }, { unique: true }),
    db.collection('jobs').createIndex({ state: 1, availableAt: 1 }),
    db.collection('findings').createIndex({ foundAt: -1 }),
  ]);
}

app.post('/api/webhooks/github', rateLimit({ windowMs: 60000, limit: 300 }), express.raw({ type: 'application/json', limit: '2mb' }), async (req, res) => {
  if (!db) return res.status(503).json({ error: 'GitHub integration is not configured' });
  if (!Buffer.isBuffer(req.body) || !verifySignature(req.body, req.get('x-hub-signature-256'), config.GITHUB_WEBHOOK_SECRET)) return res.sendStatus(401);
  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch { return res.sendStatus(400); }
  if (String(payload.installation?.id) !== config.GITHUB_INSTALLATION_ID) return res.sendStatus(403);
  if (req.get('x-github-event') !== 'push' || payload.deleted) return res.sendStatus(204);
  const repository = payload.repository?.full_name;
  if (payload.repository?.private !== false || !/^[\w.-]+\/[\w.-]+$/.test(repository || '')) return res.sendStatus(400);
  if (!Array.isArray(payload.commits) || payload.commits.length > 2048 || payload.commits.some(c => !/^[a-f0-9]{40}$/.test(c.id || ''))) return res.sendStatus(400);
  for (const commit of payload.commits) {
    await db.collection('jobs').updateOne({ repository, sha: commit.id }, { $setOnInsert: { repository, sha: commit.id, state: 'queued', attempts: 0, createdAt: new Date(), availableAt: new Date() } }, { upsert: true });
  }
  await db.collection('state').updateOne({ _id: 'webhook' }, { $set: { lastEvent: new Date(), repository, truncated: payload.size > payload.commits.length } }, { upsert: true });
  res.status(202).json({ accepted: payload.commits.length });
});
app.use(express.json({ limit: '8kb' }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 180 }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.get('origin') !== config.APP_ORIGIN) return res.status(403).json({ error: 'Invalid request origin' });
  next();
});
app.get('/api/health', (_req, res) => res.json({ configured, mode: configured ? 'live' : 'demo' }));
const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.NODE_ENV === 'production', path: '/' };
app.post('/api/login', rateLimit({ windowMs: 900000, limit: 10 }), (req, res) => {
  if (!configured) return res.status(503).json({ error: 'Configure backend environment first' });
  if (!verifyPassword(req.body?.password, config.ADMIN_PASSWORD_HASH)) return res.status(401).json({ error: 'Incorrect password' });
  res.cookie('radar_session', createSession(config.SESSION_SECRET), { ...cookieOptions, maxAge: 28800000 }).json({ ok: true });
});
app.post('/api/logout', (_req, res) => res.clearCookie('radar_session', cookieOptions).json({ ok: true }));
app.use('/api', (req, res, next) => {
  const token = req.headers.cookie?.split('; ').find(c => c.startsWith('radar_session='))?.slice(14);
  if (!configured || !validSession(token, config.SESSION_SECRET)) return res.status(401).json({ error: 'Sign in required' });
  next();
});
app.get('/api/dashboard', async (_req, res) => {
  const [findings, total, open, queued, failed, completed, repositories, webhook, partial] = await Promise.all([
    db.collection('findings').find({}, { projection: { fingerprint: 0 } }).sort({ foundAt: -1 }).limit(200).toArray(),
    db.collection('findings').countDocuments(), db.collection('findings').countDocuments({ status: 'Open' }),
    db.collection('jobs').countDocuments({ state: { $in: ['queued', 'processing'] } }), db.collection('jobs').countDocuments({ state: 'failed' }),
    db.collection('jobs').countDocuments({ state: 'complete' }), db.collection('jobs').distinct('repository'), db.collection('state').findOne({ _id: 'webhook' }), db.collection('jobs').countDocuments({ partial: true }),
  ]);
  res.json({ findings, total, open, queued, failed, completed, partial, repositories, providers: providers.map(({ id, name }) => ({ id, name })), lastScan, lastError, webhook, working });
});
app.patch('/api/findings/:id', async (req, res) => {
  if (!/^[a-f0-9]{24}$/.test(req.params.id) || !['Open', 'Resolved', 'Dismissed'].includes(req.body?.status)) return res.status(400).json({ error: 'Invalid finding or status' });
  const result = await db.collection('findings').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: req.body.status, updatedAt: new Date() } });
  if (!result.matchedCount) return res.sendStatus(404);
  res.json({ ok: true });
});
app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.status === 413 ? 'Payload too large' : 'Internal request error');
  res.status(error.status === 413 ? 413 : 500).json({ error: error.status === 413 ? 'Payload too large' : 'Request failed. Try again.' });
});

async function tick() {
  if (!db || working || stopping) return;
  working = true;
  let job;
  try {
    job = await db.collection('jobs').findOneAndUpdate({ $or: [{ state: 'queued', availableAt: { $lte: new Date() } }, { state: 'processing', leaseUntil: { $lt: new Date() } }] }, { $set: { state: 'processing', leaseUntil: new Date(Date.now() + 30 * 60000) }, $inc: { attempts: 1 } }, { returnDocument: 'after', sort: { createdAt: 1 } });
    if (!job) return;
    const { files, partial } = await github.addedText(job.repository, job.sha);
    for (const file of files) {
      const matches = scan(file.additions.map(a => a.text).join('\n'), config.FINGERPRINT_SECRET);
      for (const finding of matches) {
        finding.line = file.additions[finding.line - 1]?.line || 1;
        await db.collection('findings').updateOne({ repository: job.repository, commit: job.sha, path: file.path, fingerprint: finding.fingerprint }, { $setOnInsert: { ...finding, repository: job.repository, commit: job.sha, path: file.path, foundAt: new Date(), status: 'Open' } }, { upsert: true });
      }
    }
    lastScan = new Date(); lastError = null;
    await db.collection('jobs').updateOne({ _id: job._id }, { $set: { state: 'complete', completedAt: lastScan, partial } });
    await db.collection('state').updateOne({ _id: 'scan' }, { $set: { lastScan } }, { upsert: true });
  } catch (error) {
    lastError = /^GitHub (HTTP|authentication HTTP) \d+$/.test(error.message) ? error.message : 'Scan failed; check integration and database connectivity';
    console.error(lastError);
    if (job) await db.collection('jobs').updateOne({ _id: job._id }, { $set: { state: job.attempts >= 5 ? 'failed' : 'queued', availableAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts)), error: lastError } }).catch(() => console.error('Could not persist scan failure'));
  } finally { working = false; }
}
if (db) lastScan = (await db.collection('state').findOne({ _id: 'scan' }))?.lastScan || null;
const timer = setInterval(tick, 2000);
const server = app.listen(Number(config.PORT || 3001), '127.0.0.1', () => console.log(`Radar API listening on ${config.PORT || 3001} (${configured ? 'live' : 'demo; copy .env.example to .env'})`));
async function shutdown() {
  stopping = true; clearInterval(timer); server.close();
  while (working) await new Promise(resolve => setTimeout(resolve, 100));
  await client?.close();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
