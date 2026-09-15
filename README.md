# Radar

Secret-exposure monitoring for public repositories installed in a GitHub App. React/Vite frontend, native Node API, Netlify background/scheduled functions, Supabase PostgreSQL queue and redacted findings.

**Production setup:** [docs/PRODUCTION.md](docs/PRODUCTION.md). The original MongoDB implementation has been replaced; existing MongoDB data is not automatically imported.

## Local development

Node 22.12+ and npm required.

```powershell
npm ci
Copy-Item backend/.env.example backend/.env
npm run dev
```

Do not overwrite an existing `.env`. Fill backend variables and apply the SQL migration to a development Supabase project. Open http://127.0.0.1:5173. The local worker checks jobs every two seconds.

Missing configuration shows setup status, not fake findings. For an explicit local UI demonstration only, set `RADAR_DEMO=true` in backend `.env`; production ignores that option and the production frontend does not enter demo mode.

## Checks

```powershell
npm test
npm run build
npx netlify build --offline --filter @radar/frontend
```

Tests use synthetic credentials, a local PostgreSQL engine (PGlite, development-only dependency), and HTTP mocks. They check all ten provider rules, redaction, entropy rejection, webhook authentication, cookie sessions, SQL grants/RLS, durable claims, stale-lease rejection and atomic persistence. They do not establish live Netlify/Supabase/GitHub integration success.

## Architecture

Signed GitHub push → authenticated API → Supabase queue → background worker → pattern/entropy detection → redacted SQL findings → dashboard polling.

Only installation-authorized public repository events are accepted. No global GitHub search or provider credential validation. Raw source and candidate credentials exist only in worker memory. Stored HMAC fingerprints are excluded from dashboard responses.

Netlify configuration lives in `netlify.toml`; functions share the same backend modules as local Node execution. A scheduled function dispatches pending work every minute on published deployments. API sessions and rate limits protect the dashboard; secret Supabase keys remain server-side.

## Adding providers

Add a bounded regex and optional context rule in `backend/src/scanner.js`, display metadata in `frontend/src/demo.js`, and synthetic positive/negative tests. Coverage currently includes OpenAI, Anthropic, Gemini, OpenRouter, xAI, Groq, Cerebras, Slack, Discord and Telegram. Provider formats can change; detection is heuristic, not proof a key is active.

See production guide for coverage limits, secrets, permissions, failure recovery and rollback.
