import test from 'node:test';
import assert from 'node:assert/strict';
import { scan, entropy } from '../src/scanner.js';
const random = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL';
test('provider candidates are redacted, deduplicated and never returned raw', () => {
  const key = `sk-proj-${random}${random}`;
  const result = scan(`OPENAI_API_KEY=${key}\nOPENAI_API_KEY=${key}`, 'salt');
  assert.equal(result.length, 1); assert.equal(result[0].provider, 'openai');
  assert.equal(result[0].line, 1); assert.ok(!JSON.stringify(result).includes(key));
  assert.equal(result[0].redacted, 'sk-p••••••••••••••••');
  assert.notEqual(result[0].fingerprint, scan(`OPENAI_API_KEY=${key}`, 'other')[0].fingerprint);
});
test('rejects low entropy and context-free ambiguous keys', () => {
  assert.equal(entropy('aaaaaaaa'), 0);
  assert.equal(scan(`OPENAI_API_KEY=sk-${'a'.repeat(50)}`, 'salt').length, 0);
  assert.equal(scan(`token=sk-${random}${random}`, 'salt').length, 0);
});
test('recognizes all ten providers without classifying Anthropic as OpenAI', () => {
  const cases = [
    ['openai', `OPENAI_API_KEY=sk-proj-${random}${random}`],
    ['anthropic', `sk-ant-${random}${random}`], ['gemini', `GEMINI_API_KEY=AIza${random}abC`],
    ['openrouter', `sk-or-v1-${'a1b2c3d4e5f60789'.repeat(4)}`], ['xai', `xai-${random}${random}`],
    ['groq', `gsk_${random}${random}`], ['cerebras', `csk-${random}${random}`],
    ['slack', `xoxb-1234567890-${random}`], ['discord', `Mz${random.slice(0,24)}.Ab3dE6.${random}`],
    ['telegram', `1234567890:${random}abC`],
  ];
  for (const [provider, value] of cases) {
    const results = scan(value, 'salt');
    assert.equal(results.length, 1, provider); assert.equal(results[0].provider, provider);
  }
});
