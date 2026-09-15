import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL queue, atomic persistence, permissions and dashboard contracts', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('../../supabase/migrations/20260915022051_radar_backend.sql', import.meta.url), 'utf8'));
    await db.exec('set role service_role;');
    const rpc = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
    const enqueue = () => rpc('select public.radar_enqueue($1, $2, false) as result', ['example/repo', JSON.stringify(['a'.repeat(40)])]);
    assert.equal(await enqueue(), 1);
    assert.equal(await enqueue(), 0, 'redelivery must not duplicate jobs');
    const job = await rpc('select public.radar_claim() as result');
    assert.equal(job.attempts, 1);
    assert.equal(await rpc('select public.radar_claim() as result'), null, 'one active scan at a time');
    const finding = { path: '.env', provider: 'openai', providerName: 'OpenAI', fingerprint: 'b'.repeat(64), redacted: 'sk-p' + '•'.repeat(16), line: 1, confidence: 'High' };
    const finish = (claim, findings) => rpc('select public.radar_finish($1, $2, $3, true) as result', [job.id, claim, JSON.stringify(findings)]);
    assert.equal(await finish('00000000-0000-0000-0000-000000000000', [finding]), false, 'stale worker cannot write');
    await assert.rejects(finish(job.claim_id, [{ ...finding, redacted: 'unredacted candidate' }]), /check constraint/);
    assert.equal(await finish(job.claim_id, [finding]), true);
    assert.equal(await finish(job.claim_id, [finding]), false);
    const dashboard = await rpc('select public.radar_dashboard() as result');
    assert.equal(dashboard.total, 1); assert.equal(dashboard.partial, 1);
    assert.equal(dashboard.findings[0].providerName, 'OpenAI');
    assert.equal('fingerprint' in dashboard.findings[0], false);
    assert.equal(await rpc('select public.radar_status($1, $2) as result', [dashboard.findings[0]._id, 'Resolved']), true);
    assert.equal((await rpc('select public.radar_dashboard() as result')).open, 0);
    assert.equal(await rpc("select public.radar_limit('test', 60, 1) as result"), true);
    assert.equal(await rpc("select public.radar_limit('test', 60, 1) as result"), false);
    await db.exec("set role anon;");
    await assert.rejects(db.query('select * from public.radar_findings'), /permission denied/);
    await assert.rejects(db.query('select public.radar_dashboard()'), /permission denied/);
    await db.exec('set role authenticated;');
    await assert.rejects(db.query('select public.radar_claim()'), /permission denied/);
    await db.exec('reset role;');
    const policies = await db.query("select relrowsecurity from pg_class where relname in ('radar_jobs', 'radar_findings', 'radar_state', 'radar_limits')");
    assert.equal(policies.rows.length, 4); assert.ok(policies.rows.every(r => r.relrowsecurity));
    await db.exec("set role service_role; update public.radar_jobs set state='processing', lease_until=now()-interval '1 minute', attempts=5;");
    assert.equal(await rpc('select public.radar_claim() as result'), null);
    assert.equal((await rpc('select public.radar_dashboard() as result')).failed, 1);
  } finally { await db.close(); }
});
