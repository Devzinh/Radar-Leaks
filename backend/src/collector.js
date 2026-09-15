import { Store } from './store.js';

// Bounded public-feed sampling: never claim complete GitHub coverage.
export function publicJobs(events, seen = []) {
  const known = new Set(seen);
  return events.filter(event => event?.public === true && event.type === 'PushEvent'
    && typeof event.id === 'string' && !known.has(event.id)
    && /^[\w.-]+\/[\w.-]+$/.test(event.repo?.name || '')
    && /^[a-f0-9]{40}$/.test(event.payload?.head || '')
    && !/^0{40}$/.test(event.payload.head))
    .map(event => ({ repository: event.repo.name, sha: event.payload.head }));
}

export async function collectPublic(env, store = new Store(env), request = fetch) {
  // Database-backed gate coordinates concurrent local/background invocations.
  if (!await store.rpc('limit', { p_key: 'public-collector', p_seconds: 300, p_limit: 1 })) return;
  const previous = await store.collectorState();
  if (previous.nextPoll && Date.parse(previous.nextPoll) > Date.now()) return;
  let nextPoll = new Date(Date.now() + 300000).toISOString();
  try {
    const dashboard = await store.rpc('dashboard');
    if (dashboard.queued >= 100) {
      await store.saveCollector({ ...previous, status: 'backpressure', nextPoll, checkedAt: new Date().toISOString(), error: null });
      return;
    }
    const response = await request('https://api.github.com/events?per_page=100', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(previous.etag ? { 'If-None-Match': previous.etag } : {}) },
      signal: AbortSignal.timeout(20000),
    });
    const seconds = Math.max(300, Number(response.headers.get('x-poll-interval')) || 0,
      Number(response.headers.get('retry-after')) || 0,
      response.headers.get('x-ratelimit-remaining') === '0' ? Number(response.headers.get('x-ratelimit-reset')) - Date.now() / 1000 : 0);
    nextPoll = new Date(Date.now() + Math.min(seconds, 86400) * 1000).toISOString();
    if (response.status !== 304 && !response.ok) throw new Error(`GitHub public events HTTP ${response.status}`);
    const events = response.status === 304 ? [] : await response.json();
    if (!Array.isArray(events) || events.length > 100) throw new Error('Invalid public events response');
    const candidates = publicJobs(events, previous.seen);
    const jobs = candidates.slice(0, Math.min(10, 100 - dashboard.queued));
    const accepted = await store.enqueuePublic(jobs);
    await store.saveCollector({ status: 'active', lastPoll: new Date().toISOString(), nextPoll,
      etag: response.headers.get('etag') || previous.etag, seen: events.length ? events.map(e => e.id).filter(id => typeof id === 'string') : previous.seen || [],
      accepted: (previous.accepted || 0) + accepted, skipped: (previous.skipped || 0) + candidates.length - jobs.length,
      sampled: events.length, error: null });
  } catch (error) {
    const message = /^GitHub public events HTTP \d+$/.test(error.message) ? error.message : 'Public collector failed; retry scheduled';
    await store.saveCollector({ ...previous, status: 'error', nextPoll, checkedAt: new Date().toISOString(), error: message });
    console.error(message);
  }
}
