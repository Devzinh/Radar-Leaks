import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorker } from '../src/worker.js';

test('worker sends only redacted findings to persistence and preserves actual line number', async () => {
  const token = 'sk-proj-' + 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL'.repeat(2);
  const writes = []; let claimed = false;
  const store = { rpc: async (name, args) => {
    if (name === 'claim') { if (claimed) return null; claimed = true; return { id: 'job', claim_id: 'lease', repository: 'test/repo', sha: 'a'.repeat(40) }; }
    writes.push({ name, args }); return true;
  } };
  await runWorker({ FINGERPRINT_SECRET: 'unit-test' }, store, { addedText: async () => ({ partial: false, files: [{ path: 'config', additions: [{ text: `OPENAI_API_KEY=${token}`, line: 42 }] }] }) });
  assert.equal(writes[0].name, 'finish');
  assert.equal(writes[0].args.p_findings[0].line, 42);
  assert.equal(JSON.stringify(writes).includes(token), false);
});

test('worker sanitizes upstream errors and returns failed job to durable retry path', async () => {
  const writes = []; let claimed = false;
  const store = { rpc: async (name, args) => { if (name === 'claim') { if (claimed) return null; claimed = true; return { id: 'job', claim_id: 'lease' }; } writes.push({ name, args }); } };
  await runWorker({}, store, { addedText: async () => { throw new Error('sensitive upstream body'); } });
  assert.equal(writes[0].name, 'fail');
  assert.equal(JSON.stringify(writes).includes('sensitive upstream body'), false);
});
