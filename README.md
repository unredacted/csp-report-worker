# csp-report-worker

A Cloudflare Worker that accepts [CSP violation reports](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP) from browsers, deduplicates them, stores them in Workers KV, and forwards notifications via webhooks and pluggable email providers.

## Features

- **Dual-format ingestion** — accepts both legacy `report-uri` (`application/csp-report`) and modern Reporting API v1 `report-to` (`application/reports+json`) formats
- **Deduplication** — SHA-256 fingerprint-based suppression window prevents notification floods from repeated violations
- **KV storage** — all reports stored with configurable TTL, retrievable via authenticated API
- **Webhook notifications** — fire-and-forget POST to Slack, Discord, or any HTTP endpoint
- **Pluggable email providers** — send via Mailgun, AWS SES, Resend, or Cloudflare Email Workers
- **Edge-native** — runs entirely on Cloudflare's edge with no Node.js dependencies

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/unredacted/csp-report-worker.git
cd csp-report-worker
npm install
```

### 2. Create your config

```bash
cp wrangler-example.toml wrangler.toml
```

> **Note:** `wrangler.toml` is gitignored. Your local config (with real KV namespace IDs, webhook URLs, etc.) will not be committed.

### 3. Create a KV namespace

```bash
npx wrangler kv namespace create CSP_REPORTS
```

Copy the output ID into your `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CSP_REPORTS"
id = "paste-your-id-here"
```

> **Tip:** The worker dynamically auto-discovers the KV namespace at runtime, so the `binding` name can be whatever you prefer (e.g. `KV`, `STORAGE`, `CSP_REPORTS`).

### 4. Configure environment variables

Edit your `wrangler.toml` to set notification targets:

```toml
[vars]
NOTIFY_EMAILS = "security@example.com,ops@example.com"
NOTIFY_WEBHOOKS = "https://hooks.slack.com/services/T.../B.../xxx"
EMAIL_FROM = "csp-reports@yourdomain.com"
EMAIL_PROVIDER = "mailgun"  # or "ses", "resend", "cloudflare"
DEDUP_WINDOW_MINUTES = "60"
KV_TTL_SECONDS = "604800"
ALLOWED_ORIGINS = ""
MUTE_BLOCKED_URI_PREFIXES = ""  # empty = mute browser-extension noise from notifications (default)
```

#### Muting browser-extension noise from notifications

By default, the worker **stores every report** but **suppresses email/webhook notifications** for reports whose `blockedUri` starts with a browser-extension or browser-internal scheme (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`, `safari-extension://`, `webkit-masked-url://`, `chrome://`, `about:`). These reports are caused by user-installed browser extensions: they don't indicate a problem with the site itself, but they are useful as a passive log of visitor browser behaviour and remain available for forensic review through the API.

Configure the mute list with `MUTE_BLOCKED_URI_PREFIXES`:

| Value | Behavior |
|-------|----------|
| Unset / empty | Use the built-in defaults above. |
| `"none"` | Disable muting entirely — every report fires notifications. |
| `"prefix1,prefix2,..."` | Replace the default list with this explicit list. The operator takes full responsibility for what's muted. |

Muted reports are still:
- stored in KV,
- counted toward dedup state,
- returned by `GET /reports` and `GET /reports/:id`.

Only the email/webhook dispatch is suppressed.

`data:`, `blob:`, the literal `inline`, and `eval` are deliberately **not** in the default list — each can carry real XSS signal. If you want to mute them on a specific deployment, add them to `MUTE_BLOCKED_URI_PREFIXES`.

### 5. Set the API token (secret)

```bash
npx wrangler secret put API_TOKEN
```

This token is used to authenticate `GET /reports` API requests.

### 6. Deploy

```bash
npm run deploy
```

### 7. Custom domain (optional)

By default the worker is available at `https://csp-report-worker.<your-subdomain>.workers.dev`. To serve it on your own domain (e.g. `csp.yourdomain.com`):

1. Ensure the domain is on a Cloudflare zone in your account
2. Add a custom domain route in your `wrangler.toml`:

```toml
[[routes]]
pattern = "csp.yourdomain.com/*"
custom_domain = true
```

3. Redeploy with `npm run deploy` — Wrangler will automatically create the DNS record

> **Tip:** You can also use route patterns if you prefer to manage DNS manually. See the examples in `wrangler-example.toml`.

### 8. Configure your CSP header

Point your site's CSP header at the worker (replace the URL with your custom domain or workers.dev address):

```
Content-Security-Policy: default-src 'self'; script-src 'self'; report-uri https://csp.yourdomain.com/report
```

For the modern Reporting API:

```
Content-Security-Policy: default-src 'self'; script-src 'self'
Reporting-Endpoints: csp-endpoint="https://csp.yourdomain.com/report"
Content-Security-Policy: default-src 'self'; script-src 'self'; report-to csp-endpoint
```


## API Reference

### Report Ingestion

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/report` | Primary ingestion endpoint |
| `POST` | `/report/csp` | Alias (for `report-uri` convention) |

Both return `204 No Content` on success. Browsers expect this and do not read the body.

### Health & auth probes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Returns `204` — uptime checks (no auth) |
| `GET` | `/auth/check` | Returns `204` for a valid `Authorization: Bearer <API_TOKEN>` header, otherwise `401`/`403`. Used by the dashboard login flow to validate a token without side effects. |

### Reports API (authenticated)

All `GET` endpoints require `Authorization: Bearer <API_TOKEN>`.

#### `GET /reports`

List recent reports (newest first).

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit` | `50` | Number of reports (max 200) |
| `cursor` | — | Pagination cursor from previous response |
| `directive` | — | Filter by violated directive (e.g. `script-src`) |
| `category` | — | Filter by source category (see below) |

Valid `category` values: `extension`, `browser-internal`, `inline`, `data`, `blob`, `eval`, `same-origin`, `external`, `unknown`. Categories are derived at ingestion from `blockedUri` + `documentUri` and stored on every report.

```bash
# Recent reports
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-worker.workers.dev/reports?limit=10&directive=script-src

# Manual audit of muted browser-extension reports
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-worker.workers.dev/reports?category=extension

# High-signal inline-script violations only
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-worker.workers.dev/reports?category=inline
```

Response:
```json
{
  "reports": [{ "id": "...", "violatedDirective": "script-src", ... }],
  "cursor": "..."
}
```

#### `GET /reports/:id`

Fetch a single report by its SHA-256 ID.

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-worker.workers.dev/reports/abc123...
```

## Dashboard

The Worker also serves a small dashboard SPA from `/`. It uses the same Bearer token as the API for authentication and is built with React 19, Tailwind CSS v4, and shadcn/ui. The login screen prompts for the API token and stores it in `sessionStorage` (cleared when the browser closes); every API call is sent with `Authorization: Bearer <token>`.

```bash
# Start the worker locally
npm run dev

# In another terminal, start the dashboard's dev server (with API proxy)
npm run dev:dashboard
```

The dashboard build outputs to `dist/` and is bundled into the Worker by Wrangler via the `[assets]` binding in `wrangler.toml`. `npm run deploy` builds the SPA before invoking `wrangler deploy`.

## Architecture

```
Browser                    Worker                         External
  │                          │                               │
  ├─POST /report────────────►│                               │
  │  (csp-report or          │──parse + normalise            │
  │   reports+json)          │──compute fingerprint          │
  │                          │──check dedup (KV)             │
  │◄─── 204 ─────────────────│                               │
  │                          │                               │
  │                     ctx.waitUntil()                      │
  │                          │──store report (KV)            │
  │                          │──if new: notify               │
  │                          │   ├──webhook POST ───────────►│
  │                          │   └──email (provider) ────────►│
```

### Email Providers

The `EMAIL_PROVIDER` variable selects the email backend. Set it to one of:

| Provider | `EMAIL_PROVIDER` | Required Vars | Required Secrets |
|----------|-----------------|---------------|------------------|
| **Mailgun** | `mailgun` | `MAILGUN_DOMAIN`, `MAILGUN_REGION` | `MAILGUN_API_KEY` |
| **AWS SES** | `ses` | `AWS_SES_REGION` | `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` |
| **Resend** | `resend` | — | `RESEND_API_KEY` |
| **Cloudflare** | `cloudflare` | — | — (uses `[[send_email]]` binding) |

Leave `EMAIL_PROVIDER` empty to disable email notifications entirely.

Secrets are set via `wrangler secret put <NAME>` and are never stored in config files.

### KV Key Design

| Key pattern | Value | TTL |
|-------------|-------|-----|
| `report:{invertedTs}:{id}` | Full normalised report JSON | `KV_TTL_SECONDS` |
| `idx:{id}` | Pointer to primary key | `KV_TTL_SECONDS` |
| `dedup:{fingerprint}` | `{ count, firstSeen }` | `DEDUP_WINDOW_MINUTES × 60` |

**Inverted timestamp** (`9999999999999 - Date.now()`) ensures KV's lexicographic `list()` returns newest reports first, enabling efficient cursor-based pagination.

### Deduplication

The fingerprint is a SHA-256 hash of:
```
blockedUri | violatedDirective | documentUri | sourceFile:lineNumber
```

This groups identical violations. When a report's fingerprint is seen for the first time in its dedup window, a notification fires. Subsequent duplicates within the window are stored but do not trigger notifications.

## Email Setup

Email is optional — set `EMAIL_PROVIDER` to enable it. All providers require `EMAIL_FROM` to be set.

### Mailgun

1. Create a Mailgun account and verify your sending domain
2. Set your vars:
   ```toml
   EMAIL_PROVIDER = "mailgun"
   MAILGUN_DOMAIN = "mg.yourdomain.com"
   MAILGUN_REGION = "us"  # or "eu"
   ```
3. Set the API key secret: `wrangler secret put MAILGUN_API_KEY`

### AWS SES

1. Verify your sender domain/email in the [SES console](https://console.aws.amazon.com/ses/)
2. Create an IAM user with `ses:SendEmail` permission
3. Set your vars:
   ```toml
   EMAIL_PROVIDER = "ses"
   AWS_SES_REGION = "us-east-1"
   ```
4. Set secrets:
   ```bash
   wrangler secret put AWS_SES_ACCESS_KEY_ID
   wrangler secret put AWS_SES_SECRET_ACCESS_KEY
   ```

### Resend

1. Create a [Resend](https://resend.com) account and add your domain
2. Set your vars:
   ```toml
   EMAIL_PROVIDER = "resend"
   ```
3. Set the API key secret: `wrangler secret put RESEND_API_KEY`

### Cloudflare Email Workers

Requires [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/) on the zone.

1. Enable Email Routing and verify destination addresses
2. Uncomment the `[[send_email]]` binding in `wrangler.toml`
3. Set your vars:
   ```toml
   EMAIL_PROVIDER = "cloudflare"
   ```

## Development

```bash
# Run locally
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Generate wrangler types
npm run types
```

### Testing

Tests use [`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/) which runs inside the `workerd` runtime with real KV bindings (via Miniflare).

```bash
npm test
```

## Project Structure

```
csp-report-worker/
├── src/
│   ├── index.ts              # Worker entrypoint, router
│   ├── ingest.ts             # Parse + normalise incoming reports
│   ├── dedup.ts              # Fingerprint + KV dedup logic
│   ├── store.ts              # KV read/write for reports
│   ├── config.ts             # Environment variable parsing
│   ├── auth.ts               # Bearer token check
│   ├── api.ts                # GET /reports handlers
│   ├── types.ts              # Shared TypeScript types
│   └── notify/
│       ├── index.ts          # Notification orchestrator
│       ├── email.ts          # Email dispatch (provider-agnostic)
│       ├── provider.ts       # Email provider interface + factory
│       ├── webhook.ts        # Generic webhook POST
│       └── format.ts         # Plain text + HTML + Slack formatters
├── test/
│   ├── ingest.test.ts
│   ├── dedup.test.ts
│   ├── format.test.ts
│   ├── email.test.ts
│   └── api.test.ts
├── wrangler-example.toml         # Template — copy to wrangler.toml
├── wrangler.toml                 # Your local config (gitignored)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── env.d.ts
├── AGENTS.md                     # AI agent guidelines
└── LICENSE                       # GPL-3.0
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
