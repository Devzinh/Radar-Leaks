export class Store {
  constructor(env) { this.url = env.SUPABASE_URL?.replace(/\/$/, ''); this.key = env.SUPABASE_SECRET_KEY; }
  async rpc(name, args = {}) {
    const response = await fetch(`${this.url}/rest/v1/rpc/radar_${name}`, {
      method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Database HTTP ${response.status}`);
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }
}
