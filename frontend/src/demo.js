export const providerList = [
  ['openai', 'OpenAI', '◎', '#d8f3df'], ['anthropic', 'Anthropic', 'A', '#efd4bb'],
  ['gemini', 'Gemini', '✦', '#c5d9ff'], ['openrouter', 'OpenRouter', '⇄', '#d7d5ff'],
  ['xai', 'xAI', '𝕏', '#e0e5e2'], ['groq', 'Groq', 'g', '#ffcfb9'],
  ['cerebras', 'Cerebras', '▤', '#ffd4be'], ['slack', 'Slack', '#', '#d5d6ff'],
  ['discord', 'Discord', '◉', '#cbd0ff'], ['telegram', 'Telegram', '➤', '#bfdef4'],
].map(([id, name, symbol, color]) => ({ id, name, symbol, color }));
const samples = [
  ['openai', 'nova-labs / ai-playground', 'config/settings.py', 'sk-p', 2, 'High'],
  ['anthropic', 'devspace / assistant-api', '.env.production', 'sk-a', 7, 'High'],
  ['slack', 'acme-tools / notification-service', 'src/integrations/slack.ts', 'xoxb', 12, 'High'],
  ['gemini', 'pixelworks / vision-sandbox', 'notebooks/explore.ipynb', 'AIza', 18, 'Medium'],
  ['openrouter', 'nova-labs / llm-router', 'examples/quickstart.py', 'sk-o', 24, 'High'],
  ['discord', 'community-dev / helper-bot', 'bot/config.js', 'MzI2', 31, 'High'],
  ['groq', 'inference-lab / speed-bench', '.env.local', 'gsk_', 43, 'High'],
  ['telegram', 'acme-tools / alerts', 'settings.yaml', '7241', 58, 'Medium'],
];
export function demoData() {
  return { findings: samples.map(([provider, repository, path, prefix, minutes, confidence], i) => ({ _id: `demo-${i}`, provider, providerName: providerList.find(p => p.id === provider).name, repository: repository.replaceAll(' ', ''), path, redacted: `${prefix}••••••••••••••••`, foundAt: new Date(Date.now() - minutes * 60000).toISOString(), status: i === 6 ? 'Resolved' : 'Open', severity: 'High', confidence, line: 14 + i * 7, commit: 'a71bc92', demo: true })), total: 8, open: 7, completed: 1248, queued: 0, failed: 0, repositories: samples.map(s => s[1]), lastScan: null };
}
