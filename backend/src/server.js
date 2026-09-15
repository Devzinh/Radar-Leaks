import { createServer } from 'node:http';
import { handleRequest } from './api.js';
import { configuration } from './config.js';
import { runWorker } from './worker.js';
import { collectPublic } from './collector.js';

const env = process.env;
let working = false;
async function tick() {
  if (working || !configuration(env).configured) return;
  working = true;
  try {
    try { await collectPublic(env); } catch { console.error('Public collector unavailable'); }
    await runWorker(env);
  } catch { console.error('Worker failed; next tick will retry'); }
  finally { working = false; }
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const request = new Request(url, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: req, duplex: 'half' } : {}) });
    const response = await handleRequest(request, { env, ip: req.socket.remoteAddress, kick: async () => {} });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Request failed'); }
});
server.listen(Number(env.PORT || 3001), '127.0.0.1', () => console.log(`Radar API on ${env.PORT || 3001}; Supabase configuration ${configuration(env).configured ? 'present' : 'incomplete'}`));
const timer = setInterval(tick, 2000);
async function shutdown() { clearInterval(timer); server.close(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
