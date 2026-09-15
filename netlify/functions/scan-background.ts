import { runWorker } from '../../backend/src/worker.js';
import { collectPublic } from '../../backend/src/collector.js';
import { equal } from '../../backend/src/security.js';
import { configuration } from '../../backend/src/config.js';
import { environment } from './_shared/environment';

export default async (request) => {
  const env = environment();
  if (request.method !== 'POST' || !configuration(env).configured || !equal(request.headers.get('x-radar-worker'), env.WORKER_SECRET)) return;
  try { await collectPublic(env); }
  catch { console.error('Public collector unavailable; existing queue will still run'); }
  await runWorker(env);
};
