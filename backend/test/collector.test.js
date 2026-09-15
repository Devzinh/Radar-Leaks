import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPublic, publicJobs } from '../src/collector.js';

const event = (id) => ({ id: String(id), public: true, type: 'PushEvent', repo: { name: 'example/repo' }, payload: { head: 'a'.repeat(40) } });
function fixture(previous = {}) {
  const writes = [];
  return { writes, rpc: async (name) => name === 'limit' ? true : { queued: 0 }, collectorState: async () => previous,
    enqueuePublic: async jobs => { writes.push(jobs); return jobs.length; }, saveCollector: async data => writes.push(data) };
}
test('public feed excludes private, malformed, deleted and already seen pushes', () => {
  assert.equal(publicJobs([event(1), { ...event(2), public: false }, { ...event(3), repo: { name: '../bad/path' } }, { ...event(4), payload: { head: '0'.repeat(40) } }, event(5)], ['5']).length, 1);
});
test('collector bounds ingestion and records sampled coverage', async () => {
  const store = fixture();
  await collectPublic({}, store, async () => new Response(JSON.stringify(Array.from({ length: 25 }, (_, i) => event(i)))));
  assert.equal(store.writes[0].length, 10);
  assert.equal(store.writes[1].skipped, 15);
  assert.equal(store.writes[1].status, 'active');
});
test('collector respects backpressure and durable retry deadlines', async () => {
  const store = fixture(); store.rpc = async name => name === 'limit' ? true : { queued: 100 };
  const noRequest = () => { throw new Error('Must not call GitHub'); };
  await collectPublic({}, store, noRequest);
  assert.equal(store.writes[0].status, 'backpressure');
  const delayed = fixture({ nextPoll: new Date(Date.now() + 3600000).toISOString() });
  await collectPublic({}, delayed, noRequest);
  assert.equal(delayed.writes.length, 0);
});
test('collector respects rate-limit retry and never stores upstream bodies', async () => {
  const store = fixture();
  await collectPublic({}, store, async () => new Response('sensitive upstream body', { status: 429, headers: { 'Retry-After': '3600' } }));
  assert.equal(store.writes[0].status, 'error');
  assert.ok(Date.parse(store.writes[0].nextPoll) > Date.now() + 3500000);
  assert.ok(!JSON.stringify(store.writes).includes('sensitive upstream body'));
});
test('conditional response keeps deduplication state', async () => {
  const store = fixture({ seen: ['1'], etag: 'test' });
  await collectPublic({}, store, async (url, options) => {
    assert.equal(options.headers['If-None-Match'], 'test');
    return new Response(null, { status: 304 });
  });
  assert.deepEqual(store.writes[1].seen, ['1']);
});
