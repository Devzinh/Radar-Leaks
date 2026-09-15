import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleRequest } from '../src/api.js';
import { hashPassword } from '../src/security.js';
const env = {
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'synthetic',
  APP_ORIGIN: 'https://radar.example', ADMIN_PASSWORD_HASH: hashPassword('synthetic-password'),
  SESSION_SECRET: 'a'.repeat(64), FINGERPRINT_SECRET: 'b'.repeat(64),
  GITHUB_APP_ID: '1', GITHUB_INSTALLATION_ID: '2', GITHUB_PRIVATE_KEY: 'synthetic',
  GITHUB_WEBHOOK_SECRET: 'c'.repeat(64), WORKER_SECRET: 'd'.repeat(64), NODE_ENV: 'production',
};
test('production never advertises demo; APIs fail closed without configuration', async () => {
  const response = await handleRequest(new Request('https://radar.example/api/health'), { env: { NODE_ENV: 'production', RADAR_DEMO: 'true' } });
  assert.deepEqual(await response.json(), { configured: false, mode: 'unconfigured' });
});
test('login, cookie authentication, origin and shared rate limits', async () => {
  const store = { rpc: async name => name === 'dashboard' ? { total: 0 } : true, collectorState: async () => ({ status: 'active', seen: ['internal'], etag: 'internal' }) };
  const send = (path, init = {}) => handleRequest(new Request('https://radar.example/api' + path, init), { env, store });
  assert.equal((await send('/dashboard')).status, 401);
  assert.equal((await send('/login', { method: 'POST', body: '{}' })).status, 403);
  const login = await send('/login', { method: 'POST', headers: { origin: env.APP_ORIGIN }, body: JSON.stringify({ password: 'synthetic-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);
  assert.equal((await send('/dashboard', { headers: { cookie: cookie.split(';')[0] } })).status, 200);
  const dashboard = await (await send('/dashboard', { headers: { cookie: cookie.split(';')[0] } })).json();
  assert.deepEqual(dashboard.collector, { status: 'active' });
  const denied = await handleRequest(new Request('https://radar.example/api/dashboard'), { env, store: { rpc: async () => false } });
  assert.equal(denied.status, 429);
});
test('signed push queues only allowed public repositories; dispatcher failure preserves acceptance', async () => {
  const calls = [];
  const store = { rpc: async (name, args) => { calls.push({ name, args }); return name === 'enqueue' ? 1 : true; } };
  const payload = { installation: { id: 2 }, repository: { private: false, full_name: 'example/repo' }, commits: [{ id: 'a'.repeat(40) }] };
  async function send(data, signature) {
    const body = JSON.stringify(data);
    return handleRequest(new Request('https://radar.example/api/webhooks/github', { method: 'POST', headers: { 'x-github-event': 'push', 'x-hub-signature-256': signature || 'sha256=' + createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(body).digest('hex') }, body }), { env, store, kick: async () => { throw new Error('offline'); } });
  }
  assert.equal((await send(payload, 'invalid')).status, 401); assert.equal(calls.length, 0);
  assert.equal((await send({ ...payload, installation: { id: 3 } })).status, 403);
  assert.equal((await send({ ...payload, repository: { ...payload.repository, private: true } })).status, 400);
  const accepted = await send(payload); assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { accepted: 1, workerStarted: false });
  assert.deepEqual(calls.find(c => c.name === 'enqueue').args.p_shas, ['a'.repeat(40)]);
});
