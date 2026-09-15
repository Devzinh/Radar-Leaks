import { createHmac } from 'node:crypto';
import { verifySignature, verifyPassword, createSession, validSession } from './security.js';
import { configuration } from './config.js';
import { Store } from './store.js';

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
async function body(request, max) {
  const chunks = []; let size = 0;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); const error = new Error('Payload too large'); error.status = 413; throw error; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
function parse(bytes) { try { return JSON.parse(bytes.toString()); } catch { const error = new Error('Invalid JSON'); error.status = 400; throw error; } }
function cookie(env, token, age) { return `radar_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${env.NODE_ENV === 'production' ? '; Secure' : ''}`; }

export async function handleRequest(request, { env, ip = 'local', store = new Store(env), kick = async () => {} }) {
  try {
    const { pathname } = new URL(request.url); const method = request.method;
    const state = configuration(env);
    if (pathname === '/api/health' && method === 'GET') return json({ configured: state.configured, mode: state.configured ? 'live' : state.demo ? 'demo' : 'unconfigured' });
    if (!state.configured) return json({ error: 'Backend setup incomplete. Check environment variables.' }, 503);
    if (pathname === '/api/webhooks/github' && method === 'POST') {
      const bytes = await body(request, 2 * 1024 * 1024);
      if (!verifySignature(bytes, request.headers.get('x-hub-signature-256'), env.GITHUB_WEBHOOK_SECRET)) return json({ error: 'Invalid signature' }, 401);
      const payload = parse(bytes);
      if (request.headers.get('x-github-event') === 'ping') return new Response(null, { status: 204 });
      if (String(payload?.installation?.id) !== env.GITHUB_INSTALLATION_ID) return json({ error: 'Installation not allowed' }, 403);
      if (request.headers.get('x-github-event') !== 'push' || payload.deleted) return new Response(null, { status: 204 });
      if (payload.repository?.private !== false || !/^[\w.-]+\/[\w.-]+$/.test(payload.repository?.full_name || '') || !Array.isArray(payload.commits) || payload.commits.length > 2048 || payload.commits.some(c => !/^[a-f0-9]{40}$/.test(c?.id || ''))) return json({ error: 'Invalid push payload' }, 400);
      if (!await store.rpc('limit', { p_key: 'webhooks', p_seconds: 60, p_limit: 300 })) return json({ error: 'Webhook rate limit exceeded' }, 429, { 'Retry-After': '60' });
      const accepted = await store.rpc('enqueue', { p_repository: payload.repository.full_name, p_shas: payload.commits.map(c => c.id), p_truncated: payload.size > payload.commits.length });
      let workerStarted = true;
      try { await kick(); } catch { workerStarted = false; console.error('Worker dispatch failed; scheduled recovery pending'); }
      return json({ accepted, workerStarted }, 202);
    }
    if (['POST', 'PATCH', 'DELETE'].includes(method) && request.headers.get('origin') !== env.APP_ORIGIN) return json({ error: 'Invalid request origin' }, 403);
    const login = pathname === '/api/login' && method === 'POST';
    const identity = createHmac('sha256', env.SESSION_SECRET).update(ip).digest('hex');
    if (!await store.rpc('limit', { p_key: `${login ? 'login' : 'api'}:${identity}`, p_seconds: login ? 900 : 60, p_limit: login ? 10 : 180 })) return json({ error: 'Too many requests. Try again later.' }, 429, { 'Retry-After': login ? '900' : '60' });
    if (login) {
      const input = parse(await body(request, 8192));
      if (!verifyPassword(input?.password, env.ADMIN_PASSWORD_HASH)) return json({ error: 'Incorrect password' }, 401);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(env, createSession(env.SESSION_SECRET), 28800) });
    }
    if (pathname === '/api/logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie(env, '', 0) });
    const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(c => c.startsWith('radar_session='))?.slice(14);
    if (!validSession(token, env.SESSION_SECRET)) return json({ error: 'Sign in required' }, 401);
    if (pathname === '/api/dashboard' && method === 'GET') return json(await store.rpc('dashboard'));
    const match = /^\/api\/findings\/([a-f0-9-]{36})$/.exec(pathname);
    if (match && method === 'PATCH') {
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(match[1])) return json({ error: 'Invalid finding' }, 400);
      const input = parse(await body(request, 8192));
      if (!['Open', 'Resolved', 'Dismissed'].includes(input?.status)) return json({ error: 'Invalid status' }, 400);
      const found = await store.rpc('status', { p_id: match[1], p_status: input.status });
      return found ? json({ ok: true }) : json({ error: 'Finding not found' }, 404);
    }
    return json({ error: 'Endpoint not found' }, 404);
  } catch (error) {
    console.error('API request failed', [400, 413].includes(error.status) ? error.message : 'Check backend configuration and database connectivity');
    return json({ error: [400, 413].includes(error.status) ? error.message : 'Backend unavailable. Check database setup and credentials.' }, error.status || 503);
  }
}
