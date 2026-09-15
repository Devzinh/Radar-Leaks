import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

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
    const key = this.config.GITHUB_PRIVATE_KEY?.replace(/\\n/g, '\n') || await readFile(this.config.GITHUB_PRIVATE_KEY_PATH, 'utf8');
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
    const token = await this.token();
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
