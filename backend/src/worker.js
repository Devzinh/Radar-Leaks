import { GitHub } from './github.js';
import { scan } from './scanner.js';
import { Store } from './store.js';
export async function runWorker(env, store = new Store(env), github = new GitHub(env)) {
  // A commit can take up to 30 API pages. Stop starting jobs after two minutes,
  // leaving ten minutes for the last commit inside the 15-minute function limit.
  const start = Date.now();
  do {
    const job = await store.rpc('claim');
    if (!job) return;
    try {
      const result = await github.addedText(job.repository, job.sha);
      const findings = [];
      for (const file of result.files) {
        for (const candidate of scan(file.additions.map(a => a.text).join('\n'), env.FINGERPRINT_SECRET)) {
          findings.push({ ...candidate, path: file.path, line: file.additions[candidate.line - 1]?.line || 1 });
          if (findings.length >= 2000) break;
        }
        if (findings.length >= 2000) { result.partial = true; break; }
      }
      const saved = await store.rpc('finish', { p_id: job.id, p_claim: job.claim_id, p_findings: findings, p_partial: result.partial });
      if (!saved) console.error('Scan lease expired before persistence');
    } catch (error) {
      const message = /^(GitHub (HTTP|authentication HTTP)|Database HTTP) \d+$/.test(error.message) ? error.message : 'Scan failed; check integration connectivity';
      await store.rpc('fail', { p_id: job.id, p_claim: job.claim_id, p_error: message });
      console.error(message);
    }
  } while (Date.now() - start < 120000);
}
export async function kickWorker(env) {
  const response = await fetch(`${env.APP_ORIGIN}/.netlify/functions/scan-background`, {
    method: 'POST', headers: { 'x-radar-worker': env.WORKER_SECRET }, signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 202) throw new Error('Worker invocation failed');
}
