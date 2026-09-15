export const environmentKeys = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'APP_ORIGIN', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'FINGERPRINT_SECRET', 'GITHUB_APP_ID', 'GITHUB_INSTALLATION_ID', 'GITHUB_PRIVATE_KEY', 'GITHUB_PRIVATE_KEY_PATH', 'GITHUB_WEBHOOK_SECRET', 'WORKER_SECRET', 'RADAR_DEMO', 'NODE_ENV'];
export function configuration(env) {
  const required = environmentKeys.filter(k => !['RADAR_DEMO', 'NODE_ENV', 'GITHUB_PRIVATE_KEY_PATH', 'GITHUB_PRIVATE_KEY'].includes(k));
  const missing = required.filter(k => !env[k]);
  if (!env.GITHUB_PRIVATE_KEY && !env.GITHUB_PRIVATE_KEY_PATH) missing.push('GITHUB_PRIVATE_KEY');
  const invalid = ['SESSION_SECRET', 'FINGERPRINT_SECRET', 'GITHUB_WEBHOOK_SECRET', 'WORKER_SECRET'].filter(k => env[k] && env[k].length < 32);
  if (env.ADMIN_PASSWORD_HASH && !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.ADMIN_PASSWORD_HASH)) invalid.push('ADMIN_PASSWORD_HASH');
  for (const k of ['GITHUB_APP_ID', 'GITHUB_INSTALLATION_ID']) if (env[k] && !/^\d+$/.test(env[k])) invalid.push(k);
  if (env.SUPABASE_URL && !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(env.SUPABASE_URL)) invalid.push('SUPABASE_URL');
  if (env.APP_ORIGIN) { try { const u = new URL(env.APP_ORIGIN); if (u.origin !== env.APP_ORIGIN || !['http:', 'https:'].includes(u.protocol) || (env.NODE_ENV === 'production' && u.protocol !== 'https:')) invalid.push('APP_ORIGIN'); } catch { invalid.push('APP_ORIGIN'); } }
  return { configured: !missing.length && !invalid.length, missing, invalid, demo: env.NODE_ENV !== 'production' && env.RADAR_DEMO === 'true' };
}
