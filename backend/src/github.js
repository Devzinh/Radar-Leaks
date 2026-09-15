import { readFile } from 'node:fs/promises';
import { createSign, createPrivateKey } from 'node:crypto';

export function parsePrivateKey(value) {
  try {
    const text = value.replace(/\\n/g, '\n').trim();
    const match = /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----([\s\S]*?)-----END \1-----$/.exec(text);
    if (!match) throw new Error('Invalid PEM envelope');
    const body = match[2].replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new Error('Invalid PEM body');
    const pem = `-----BEGIN ${match[1]}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${match[1]}-----\n`;
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('GitHub requires an RSA key');
    return key;
  } catch {
    throw new Error('GitHub private key is invalid; check GITHUB_PRIVATE_KEY');
  }
}

export class GitHub {
  constructor(config) { this.config = config; this.cached = null; }
  async request(path, token) {
    if (!path.startsWith('/')) throw new Error('Invalid GitHub path');
    const response = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return response.json();
  }
  async token() {
    if (this.cached && this.cached.until > Date.now() + 60000) return this.cached.token;
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 60, exp: now + 540, iss: this.config.GITHUB_APP_ID })}`;
    const key = parsePrivateKey(this.config.GITHUB_PRIVATE_KEY || await readFile(this.config.GITHUB_PRIVATE_KEY_PATH, 'utf8'));
    const signature = createSign('RSA-SHA256').update(payload).sign(key, 'base64url');
    const response = await fetch(`https://api.github.com/app/installations/${this.config.GITHUB_INSTALLATION_ID}/access_tokens`, {
      method: 'POST', headers: { Authorization: `Bearer ${payload}.${signature}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`GitHub authentication HTTP ${response.status}`);
    const data = await response.json();
    this.cached = { token: data.token, until: Date.parse(data.expires_at) };
    return data.token;
  }
  async addedText(repo, sha) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid commit target');
    const token = await this.token();
    const metadata = await this.request(`/repos/${repo}`, token);
    if (metadata.private !== false) throw new Error('Repository is not public');
    const files = [];
    let partial = false;
    for (let page = 1; page <= 30; page++) {
      const data = await this.request(`/repos/${repo}/commits/${sha}?per_page=100&page=${page}`, token);
      for (const file of data.files || []) {
        if (file.status === 'removed') continue;
        if (!file.patch) { partial = true; continue; }
        let line = 0;
        const additions = [];
        for (const entry of file.patch.split('\n')) {
          const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(entry);
          if (hunk) { line = Number(hunk[1]); continue; }
          if (entry.startsWith('+')) { additions.push({ text: entry.slice(1), line }); line++; }
          else if (entry.startsWith(' ')) line++;
        }
        files.push({ path: file.filename, additions });
      }
      if ((data.files || []).length < 100) return { files, partial };
    }
    return { files, partial: true };
  }
}
