# Radar

Private secret-exposure dashboard for public repositories connected to a GitHub App. React/Vite frontend, separate Express API, MongoDB-backed queue and findings.

## Run locally

Requires Node.js 22.12+ (tested with 24), npm, and Docker with its engine running for live mode.

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5173. Without backend configuration, Radar runs an explicitly labeled demonstration with synthetic, already-redacted findings. Demo changes are local and reset on reload. No MongoDB is required for the preview.

### Enable live scanning

```powershell
docker compose up -d
Copy-Item backend/.env.example backend/.env
cd backend
node scripts/hash-password.js "a-long-unique-admin-password"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the password hash into `ADMIN_PASSWORD_HASH`. Generate **three independent** random secrets for `SESSION_SECRET`, `FINGERPRINT_SECRET`, and `GITHUB_WEBHOOK_SECRET`. Keep the raw password out of `.env`; the command above can appear in shell history, so use a local password you can rotate.

1. Create a GitHub App under GitHub → Settings → Developer settings → GitHub Apps.
2. Grant **Contents: Read-only**. Subscribe to **Push** events. Metadata read access is supplied by GitHub. User OAuth is not needed: access uses short-lived installation tokens.
3. Generate its private key and save it as `backend/github-app.pem` (ignored by Git). Set `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and `GITHUB_PRIVATE_KEY_PATH` in `backend/.env`. Paths resolve from `backend/` when using the workspace commands.
4. Install the App on the public repositories you administer. One installation per Radar environment. Private repositories are rejected even if the installation can access them.
5. Expose **port 3001** through your preferred HTTPS development tunnel. Set the GitHub webhook URL to `https://YOUR-TUNNEL/api/webhooks/github` and use the same webhook secret as the backend. Do not disable signature verification.
6. Fill all remaining environment values. `APP_ORIGIN` must match the browser origin exactly (`http://127.0.0.1:5173` by default). Restart `npm run dev`, sign in, and push a commit. For detection experiments, generate synthetic strings; do not commit working credentials.

The App does not watch all of public GitHub. It receives pushes only from its installation. There is no global search, secret validation, or credential-use endpoint.

## Data flow

Signed push → installation/public-repository validation → durable per-commit MongoDB job → GitHub commit patches → added-line scan → redacted finding → dashboard polling every 10 seconds.

Jobs use atomic claims, a 30-minute lease and exponential retries (five attempts). Restarted workers recover expired claims. Unique indexes deduplicate push redelivery and findings. Run one API/worker instance per environment; rate-limit state is in process. No source patches or raw candidates are persisted. Job records retain only repository/commit metadata and sanitized errors.

The scanner identifies OpenAI, Anthropic, Gemini, OpenRouter, xAI, Groq, Cerebras, Slack, Discord and Telegram candidates. Shannon entropy below 3.5 bits/character is rejected; ambiguous OpenAI/Google prefixes require provider context. Confidence is heuristic, **not proof a credential is active**. Synthetic examples can still match; real keys can be missed.

## Privacy and authentication

- Values are reduced to four prefix characters and a fixed mask before persistence.
- HMAC-SHA256 fingerprints support deduplication; the API excludes fingerprints.
- Raw patches and tokens are never logged deliberately. Do not enable request-body logging in your proxy or instrumentation.
- Admin password uses salted scrypt. Sessions are signed, HttpOnly, SameSite=Strict, expire after eight hours and use Secure cookies in production.
- Writes require an exact Origin match. Login and API requests are rate-limited. GitHub webhooks use their own signed-raw-body endpoint.
- Logout clears the browser cookie; rotating `SESSION_SECRET` invalidates all issued sessions. This is a single-admin deployment, not a multi-tenant service.
- Repository names, paths, line numbers and commit identifiers remain stored and visible to authenticated admins. Protect database access and backups accordingly.

## Coverage limits

- Scans added lines in available commit patches, not existing history or full repository snapshots.
- Binary files, unavailable/large patches and GitHub's commit-file pagination cap cause partial scans. Partial scan totals appear on the home page.
- GitHub can omit oversized webhook deliveries or truncate commit lists. The app cannot promise complete coverage of such pushes. Check GitHub delivery history and redeliver failures.
- File paths and repository names are metadata, not scanned source. Links open GitHub, where original source may expose the credential.
- Latest 200 findings load into the dashboard; search and time/provider/status filters operate on that window. The total count covers the database.
- The hourly chart uses the loaded findings, so it is a recent-window view rather than an unbounded historical aggregate.
- Detection rules are extensible heuristics. Provider formats change; review rules against authoritative provider formats before relying on coverage.
- Failed jobs stay visible after retries. Correct the integration then reset failed jobs to `queued` and set `availableAt` to the current date using an authenticated database administration tool. There is no automatic credential rotation.

## Add a provider

Add an entry to `backend/src/scanner.js` with `id`, `name`, a bounded global `pattern`, and optional `context` regex. Add its display entry to `frontend/src/demo.js`. Add synthetic positive/negative cases in `backend/test/scanner.test.js`; never use real credentials as fixtures.

## Commands and verification

```powershell
npm test
npm run build
```

Tests cover all ten detector rules, redaction, HMAC deduplication, low-entropy rejection, signed webhook byte integrity, password verification and session tampering/expiration. Live end-to-end scanning requires MongoDB plus your GitHub App credentials; unit tests do not establish external integration success.

## Production

Build frontend with `npm run build`; serve `frontend/dist` using a static web server. Reverse-proxy `/api` on the same HTTPS origin to `127.0.0.1:3001`. Set `NODE_ENV=production` and `APP_ORIGIN` to that origin, then run `npm start`. Production refuses to start with missing configuration. Set CSP/security headers on the frontend host; API headers do not protect separately hosted HTML. Do not expose Vite or the unauthenticated local MongoDB port publicly. Use MongoDB authentication/TLS and protected backups in production. The development Compose file binds MongoDB only to loopback.

The API deliberately does not trust proxy forwarding headers. Behind a proxy, its limiter shares the proxy's IP bucket; configure an exact trusted proxy policy and a shared limiter before scaling beyond a single process. Fonts load from Google Fonts with system fallbacks; self-host them if the deployment requires no third-party font requests.

## API

| Endpoint | Access | Purpose |
| --- | --- | --- |
| GET /api/health | Public | Configuration/demo mode |
| POST /api/login | Origin + login limiter | Create admin session |
| POST /api/logout | Origin | Clear session cookie |
| POST /api/webhooks/github | GitHub HMAC signature | Queue authorized pushes |
| GET /api/dashboard | Session | Redacted findings + status |
| PATCH /api/findings/:id | Session + Origin | Open, Resolved or Dismissed |

References: [webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation), [commit API](https://docs.github.com/en/rest/commits/commits).
