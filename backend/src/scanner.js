import { createHmac } from 'node:crypto';

// Patterns identify candidates, never credential validity. Keep additions here.
export const providers = [
  { id: 'openai', name: 'OpenAI', pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,200}\b/g, context: /openai/i },
  { id: 'anthropic', name: 'Anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{32,200}\b/g },
  { id: 'gemini', name: 'Gemini', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g, context: /gemini|generativelanguage|google[_ -]?(?:api|ai)/i },
  { id: 'openrouter', name: 'OpenRouter', pattern: /\bsk-or-v1-[a-f0-9]{64}\b/g },
  { id: 'xai', name: 'xAI', pattern: /\bxai-[A-Za-z0-9_-]{32,120}\b/g },
  { id: 'groq', name: 'Groq', pattern: /\bgsk_[A-Za-z0-9]{40,80}\b/g },
  { id: 'cerebras', name: 'Cerebras', pattern: /\bcsk-[A-Za-z0-9_-]{32,120}\b/g },
  { id: 'slack', name: 'Slack', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,180}\b/g },
  { id: 'discord', name: 'Discord', pattern: /\b(?:M[Nz]|N[DE])[A-Za-z0-9_-]{20,30}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,110}\b/g },
  { id: 'telegram', name: 'Telegram', pattern: /\b[0-9]{8,12}:[A-Za-z0-9_-]{35}\b/g },
];

export function entropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  return [...counts.values()].reduce((sum, count) => {
    const p = count / value.length;
    return sum - p * Math.log2(p);
  }, 0);
}

export function scan(text, fingerprintSecret) {
  const results = [];
  const seen = new Set();
  for (const provider of providers) {
    for (const match of text.matchAll(new RegExp(provider.pattern))) {
      const candidate = match[0];
      if (provider.id === 'openai' && /^sk-(ant-|or-)/.test(candidate)) continue;
      const nearby = text.slice(Math.max(0, match.index - 100), match.index + candidate.length + 100);
      if (provider.context && !provider.context.test(nearby)) continue;
      if (/example|placeholder|your[_-]?(?:api|key|token)|changeme|dummy|test[_-]?key/i.test(candidate)) continue;
      const randomness = entropy(candidate.replace(/^[a-z]+[-_]/i, ''));
      if (randomness < 3.5) continue;
      const fingerprint = createHmac('sha256', fingerprintSecret).update(candidate).digest('hex');
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      results.push({ provider: provider.id, providerName: provider.name, fingerprint,
        redacted: `${candidate.slice(0, 4)}${'•'.repeat(16)}`, line: text.slice(0, match.index).split('\n').length,
        confidence: randomness >= 4.3 ? 'High' : 'Medium', severity: 'High' });
    }
  }
  return results;
}
