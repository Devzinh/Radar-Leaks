export class Store {
  constructor(env) { this.url = env.SUPABASE_URL?.replace(/\/$/, ''); this.key = env.SUPABASE_SECRET_KEY; }
  async table(path, options = {}) {
    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      ...options, headers: { apikey: this.key, 'Content-Type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Database HTTP ${response.status}`);
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  }
  async collectorState() {
    return (await this.table('radar_state?id=eq.collector&select=data'))[0]?.data || {};
  }
  async saveCollector(data) {
    await this.table('radar_state?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: 'collector', data }) });
  }
  async enqueuePublic(jobs) {
    if (!jobs.length) return 0;
    const inserted = await this.table('radar_jobs?on_conflict=repository,sha&select=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(jobs) });
    return inserted.length;
  }
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
