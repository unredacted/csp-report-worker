# csp-report-worker

A Cloudflare Worker that ingests [CSP violation reports](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP), groups them into **persistent issues** with a triage workflow, suggests CSP policy improvements, and notifies via email + webhooks — all on Cloudflare KV + D1, with a Svelte 5 dashboard bundled into the same Worker.

## What it does

- **Dual-format ingest** — accepts both legacy `report-uri` (`application/csp-report`) and the modern Reporting API v1 (`application/reports+json`).
- **Per-property routing** — each site gets its own `POST /r/{slug}?t={token}` ingest URL with token-gated auth. Falls back to a `default` property for the legacy `/report` path.
- **Issue grouping** — every report's deterministic SHA-256 fingerprint becomes the primary key of a per-property issue. The 10,000th occurrence of the same violation increments a counter, not a row.
- **Triage workflow** — issues move through `open → acknowledged → resolved` (or `→ ignored` from anywhere). Resolved issues auto-reopen if the violation reappears past a configurable grace window (default 24h), with a `[resurrected]` notification subject.
- **Notification gating** — emails + webhooks fire only on `null → open` (new) and `resolved → open` (resurrection) transitions. No more inbox flood from one bad ad-network beacon hitting 50,000 visitors.
- **Per-property notification overrides** — each property can specify its own `notify_emails`, `notify_webhooks`, and `mute_categories`, falling back to the global env defaults when null.
- **Source classification** — every report is bucketed at ingest as one of `extension | browser-internal | inline | data | blob | eval | same-origin | external | unknown`. The first two are muted from notifications by default since they're noise.
- **CSP policy assistant** — derives suggested `script-src` / `style-src` / `img-src` etc. additions from open issues, ranked by event count. Tick what you accept, get a copy-pasteable header. `inline` and `eval` are surfaced as opt-in toggles with risk warnings.
- **Cloudflare context capture (no IP)** — every event sample stores `country`, `asn`, `as_organization`, `colo`, `cf-ray`, and `http_protocol`. **Never the client IP.** The dashboard surfaces top-N breakdowns per issue.
- **Retention** — a scheduled handler (cron-driven) deletes issues whose `last_seen` is older than `RETENTION_DAYS` (default 90).
- **Dashboard** — Svelte 5 + TanStack Query + Tailwind v4 + bits-ui. Bearer-token auth (sessionStorage). Pages: Issues, Issue detail, Properties, Policy assistant, Raw events.
- **5 email providers** — Cloudflare Email Service, Cloudflare Email Routing, Mailgun, AWS SES, Resend.

## Architecture

```
                                        Browsers
                                            │
   POST /r/{slug}?t={token}        POST /report (legacy fallback)
            │                                │
            ▼                                ▼
       resolve property              attribute to "default" property
      (slug + token)                         │
            └──────────────┬─────────────────┘
                           ▼
                  parse + normalise
                  extract CF context (no IP)
                           ▼
                       204 returned
                           │
                  ctx.waitUntil():
                  ├── KV: storeReport ─────────────── 7-day TTL
                  ├── D1: upsertIssue (count++, last_seen=now)
                  │       insertEvent (country, ASN, …) — capped at EVENT_SAMPLE_CAP
                  └── if transition is `created` or `resurrected`:
                          dispatchNotifications(property, kind)
                              ├── webhooks (per-property override or global)
                              └── email (per-property override or global)

   GET  /issues, /issues/:id              cron (hourly):
   PATCH /issues/:id                          retention sweep
   GET/POST /properties, /properties/:id      DELETE issues WHERE last_seen < cutoff
   POST /properties/:id/rotate-token          (cascades to events + status log)
   POST /properties/:id/archive
   GET  /properties/:id/policy-suggestions
   POST /properties/:id/policy-preview
```

## Quick start

```bash
git clone https://github.com/unredacted/csp-report-worker.git
cd csp-report-worker
npm install
cp wrangler-example.toml wrangler.toml
```

`wrangler.toml` is gitignored — you'll fill in the IDs below.

### 1. Create the KV namespace and D1 database

```bash
npx wrangler kv namespace create CSP_REPORTS
npx wrangler d1 create csp-report-worker
```

Paste the IDs into your `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CSP_REPORTS"
id = "..."

[[d1_databases]]
binding = "DB"
database_name = "csp-report-worker"
database_id = "..."
```

The KV binding name is auto-discovered by constructor, so you can rename it if you prefer (e.g. `KV`). The D1 binding follows the same pattern.

The schema in `migrations/0001_init.sql` is auto-applied at first request. The DDL uses `CREATE TABLE / INDEX IF NOT EXISTS`, so applying it manually beforehand (or running it twice) is safe:

```bash
npx wrangler d1 execute DB --remote --file migrations/0001_init.sql
```

If you do seed manually, also mark the migration as applied so the runtime runner skips it cleanly:

```bash
npx wrangler d1 execute DB --remote \
  --command "INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES ('0001_init', datetime('now'))"
```

### 2. Configure environment variables

Edit `wrangler.toml` `[vars]`:

```toml
[vars]
NOTIFY_EMAILS = "security@example.com,ops@example.com"
NOTIFY_WEBHOOKS = "https://hooks.slack.com/services/..."
EMAIL_FROM = "csp-reports@yourdomain.com"
EMAIL_PROVIDER = "mailgun"  # or "ses" | "resend" | "cloudflare-email" | "cloudflare-routing"

# Issue lifecycle
RESURRECTION_GRACE_HOURS = "24"   # how long after `resolved` to suppress notifications
EVENT_SAMPLE_CAP = "100"          # max event samples per issue
RETENTION_DAYS = "90"             # 0 = disable retention

# Notification mute set (categories that are stored but never paged):
MUTE_CATEGORIES = ""              # empty = default (extension + browser-internal); "none" = page on everything
```

### 3. Set the API token (secret)

```bash
npx wrangler secret put API_TOKEN
```

This token authenticates dashboard logins and all `GET /reports`, `GET /issues`, `GET /properties`, etc. endpoints.

### 4. Deploy

```bash
npm run deploy
```

This builds the dashboard SPA into `dist/` and runs `wrangler deploy`.

### 5. Point your CSP at the worker

For the **default catch-all** path:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; report-uri https://csp.yourdomain.com/report
```

Or use the Reporting API:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; report-to csp-endpoint
Reporting-Endpoints: csp-endpoint="https://csp.yourdomain.com/report"
```

For **per-site routing** (recommended once you have multiple properties), create the property in the dashboard or via `POST /properties`, then:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; report-uri https://csp.yourdomain.com/r/marketing?t=YOUR-INGEST-TOKEN
```

The token survives in browser DevTools and request logs — treat it like a low-privilege identifier, not a secret. Rotate via `POST /properties/:id/rotate-token` whenever needed.

## Properties & per-site routing

Each property is its own scope: separate ingest URL, separate issue list, optional per-property notification routing. The synthetic `default` property exists from cold start and catches `/report` and `/report/csp` traffic so legacy deployments don't break.

### Bootstrap properties from env

Set `BOOTSTRAP_PROPERTIES` in `wrangler.toml` to seed the `properties` table on first request when no non-default property exists. Tokens are auto-generated; pull them from `GET /properties` (the dashboard does this for you):

```toml
BOOTSTRAP_PROPERTIES = '''[
  {"slug":"marketing","name":"Marketing site"},
  {"slug":"app","name":"Web app","emails":"app-sec@example.com"}
]'''
```

### Manage properties

The dashboard's **Properties** page has the UI for create / rotate-token / archive. Equivalent CLI calls:

```bash
TOK=$(cat ~/.csp-token)
BASE=https://csp.yourdomain.com

# Create
curl -X POST "$BASE/properties" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"slug":"marketing","name":"Marketing site","emails":"ops@example.com"}'

# List (tokens redacted to last 4 chars)
curl -H "Authorization: Bearer $TOK" "$BASE/properties"

# Rotate token
curl -X POST -H "Authorization: Bearer $TOK" \
  "$BASE/properties/<id>/rotate-token"

# Archive (soft-delete; reports under that slug start 404'ing)
curl -X POST -H "Authorization: Bearer $TOK" \
  "$BASE/properties/<id>/archive"
```

## Issue triage

Open the dashboard at the worker's URL, log in with the `API_TOKEN`, and you land on **Issues** — a triageable queue scoped to the selected property.

**Status flow:**

- `open` — new issues land here
- `acknowledged` — "I've seen it, working on it" (no more notifications, count still grows)
- `resolved` — fixed (no more notifications, but auto-reopens past `RESURRECTION_GRACE_HOURS` if it fires again)
- `ignored` — silenced forever (count still grows, never notifies, never auto-reopens)

**Notifications fire on:**

- `null → open` (new fingerprint) — subject: `CSP Violation: <directive> — <category> on <docUri>`
- `resolved → open` (auto-reopen past grace) — same subject prefixed with `[resurrected]`

Acknowledged / ignored issues never page, regardless of how many events they accumulate. Per-property `mute_categories` overrides the global `MUTE_CATEGORIES` env var (default: `extension,browser-internal`).

### What gets sent

**Email** (plain text + HTML alternative):
- Subject identifies directive, source category, and document host so a security engineer can triage from the inbox alone.
- Body lists violated/effective directive, disposition, source classification, document URI, blocked URI, source file + line + column, referrer, status code, user-agent, report format, timestamp, fingerprint, and the original policy.
- Includes a `View issue →` link to `https://<your-worker>/issues/<issueId>` — the triage view with status controls (Acknowledge / Resolve / Ignore) and country/ASN/browser breakdowns.

**Webhook** (POST, JSON, Slack-compatible top-level `text` field):

```json
{
  "text": "`script-src` violation on https://example.com/page — blocked https://evil.example/x.js",
  "source": "csp-report-worker",
  "event": "csp-violation",
  "kind": "new",
  "issue_id": "default:bdaa77f1917d9a5d1aebb6ea68e708de13308cbfc8edd5f86b8b6ec505e746b0",
  "report": { /* full NormalisedReport — same shape as GET /reports/:id */ },
  "summary": "...",
  "dashboard_url": "https://csp.yourdomain.com/issues/default%3Abdaa77f..."
}
```

Slack accepts the top-level `text` as the message body. The `kind` field is `"new"` or `"resurrection"`; resurrected events also have `[resurrected]` prefixed in `text` and `summary`. The `issue_id` field lets webhook consumers deep-link to the triage view directly.

## CSP policy assistant

The **Policy** page reads all `open` issues for the selected property, groups them by directive, ranks by event count, and proposes additions:

| Source category | Suggestion |
|---|---|
| `external` | The blocked URI's origin (e.g. `https://cdn.partner.com`) |
| `data` | `data:` |
| `blob` | `blob:` |
| `inline` | `'unsafe-inline'` (with risk warning) |
| `eval` | `'unsafe-eval'` (with risk warning) |
| `extension`, `browser-internal`, `same-origin`, `unknown` | Never suggested |

Paste your current header in the **Baseline policy** box, tick the suggestions you accept, and the **Preview** updates live. Hit Copy and paste into your origin's CSP header. The "Mark backing issues as acknowledged" button bulk-acks all the issues your selected suggestions came from — once you've added the token to your policy, they shouldn't keep nagging.

## API reference

All non-ingest endpoints require `Authorization: Bearer <API_TOKEN>`.

### Ingest (no auth)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/report` | Legacy catch-all — attributes to `default` property |
| `POST` | `/report/csp` | Alias for `/report` |
| `POST` | `/r/:slug?t=<token>` | Per-property — token validated; `X-Ingest-Token` header also accepted |

All return `204 No Content` on success. Browsers expect this.

### Health & auth probes

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | 204 — uptime probe (no auth) |
| `GET` | `/auth/check` | 204 on valid Bearer token (no side effects) |

### Issues

| Method | Path | Notes |
|---|---|---|
| `GET` | `/issues?property=<id>&status=open,acknowledged&directive=script-src&limit=50&cursor=...` | Keyset-paginated list |
| `GET` | `/issues/:id` | Issue + last 100 event samples + country/ASN/browser breakdowns |
| `PATCH` | `/issues/:id` | Body `{"status": "acknowledged" \| "resolved" \| "ignored" \| "open", "reason"?: "..."}` |

### Properties

| Method | Path | Notes |
|---|---|---|
| `GET` | `/properties` | List active properties (tokens redacted to last 4 chars) |
| `POST` | `/properties` | Body `{"slug":"...", "name":"...", "emails"?:"...", "webhooks"?:"...", "muteCategories"?:"..."}` — returns the full token **once** |
| `GET` | `/properties/:id` | Detail (token redacted) |
| `PATCH` | `/properties/:id` | Update notification overrides |
| `POST` | `/properties/:id/rotate-token` | Generates a new token, returns it once |
| `POST` | `/properties/:id/archive` | Soft-delete (cannot be undone via API) |

### Policy assistant

| Method | Path | Notes |
|---|---|---|
| `GET` | `/properties/:id/policy-suggestions` | Grouped + ranked suggestions |
| `POST` | `/properties/:id/policy-preview` | Body `{"baseline": "...", "selections": [{"directive":"script-src","value":"https://x.com"}]}` → `{"policy":"..."}` |

### Reports (raw event log, KV-backed)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/reports?limit=50&cursor=...&directive=script-src&category=external` | TTL-bounded raw stream — kept for debugging |
| `GET` | `/reports/:id` | Single normalised report |

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `NOTIFY_EMAILS` | `""` | Comma-separated email recipients (global default; per-property override available) |
| `NOTIFY_WEBHOOKS` | `""` | Comma-separated webhook URLs (global default; per-property override available) |
| `EMAIL_FROM` | `""` | Sender address — required for all email providers |
| `EMAIL_PROVIDER` | unset | One of `cloudflare-email \| cloudflare-routing \| mailgun \| ses \| resend` |
| `MUTE_CATEGORIES` | `extension,browser-internal` | Categories whose reports are stored but never paged. `"none"` = mute nothing. Per-property override available. |
| `RESURRECTION_GRACE_HOURS` | `24` | Hours after `resolved` before a new report auto-reopens an issue |
| `EVENT_SAMPLE_CAP` | `100` | Max event samples kept per issue (older pruned at insert time) |
| `RETENTION_DAYS` | `90` | Days to keep issues before the cron sweep deletes them. `0` = disabled. Requires `[triggers] crons` in `wrangler.toml`. |
| `KV_TTL_SECONDS` | `604800` | TTL for raw-report KV writes (7 days) |
| `ALLOWED_ORIGINS` | `""` | If set, restrict ingest to these origins (CSV) |
| `BOOTSTRAP_PROPERTIES` | unset | JSON list seeded into `properties` at first request (only when no non-default property exists) |
| `DEDUP_WINDOW_MINUTES` | — | **Deprecated** — replaced by `RESURRECTION_GRACE_HOURS` (still read for one release) |

Email-provider-specific vars (`MAILGUN_DOMAIN`, `MAILGUN_REGION`, `AWS_SES_REGION`, plus secrets `MAILGUN_API_KEY`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`, `RESEND_API_KEY`) — see "Email setup" below.

### Cron triggers

For `RETENTION_DAYS` to do anything, `wrangler.toml` must declare a cron:

```toml
[triggers]
crons = ["0 * * * *"]  # hourly
```

The scheduled handler runs `runRetentionSweep`, which deletes issues whose `last_seen` is older than the cutoff. `issue_events` and `issue_status_log` cascade-delete via foreign-key `ON DELETE CASCADE`.

## Privacy: no IP capture

The worker reads CF-supplied request context — `country`, `asn`, `as_organization`, `colo`, `cf-ray`, `http_protocol` — and stores it on each event sample. **It never reads `cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, or any other IP header.** The `issue_events` table has no `ip` column.

A test (`test/db.test.ts`) and a privacy assertion (`test/cf-context.test.ts`) verify this. If you want IP capture for forensics, that should be a deliberate, opt-in, documented schema change — don't add it casually.

## Email setup

The `EMAIL_PROVIDER` variable selects the backend:

| Provider | `EMAIL_PROVIDER` | Required vars | Required secrets |
|---|---|---|---|
| Cloudflare Email Service | `cloudflare-email` | — | `[[send_email]]` binding |
| Cloudflare Email Routing | `cloudflare-routing` | — | `[[send_email]]` binding |
| Mailgun | `mailgun` | `MAILGUN_DOMAIN`, `MAILGUN_REGION` | `MAILGUN_API_KEY` |
| AWS SES | `ses` | `AWS_SES_REGION` | `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` |
| Resend | `resend` | — | `RESEND_API_KEY` |

Leave `EMAIL_PROVIDER` empty to disable email. Webhooks still fire if `NOTIFY_WEBHOOKS` is set.

Secrets are set via `wrangler secret put <NAME>` — never in `wrangler.toml`.

### Cloudflare Email Service (recommended)

Uses Cloudflare's transactional Email Service. Doesn't take over the zone's MX records.

```toml
[[send_email]]
name = "EMAIL"
[vars]
EMAIL_PROVIDER = "cloudflare-email"
EMAIL_FROM = "alerts@yourdomain.com"
```

Onboard your sending domain in the Cloudflare dashboard and publish the SPF/DKIM records.

## Storage layout

### KV (`CSP_REPORTS`)

| Key | Value | TTL |
|---|---|---|
| `report:{invertedTs}:{id}` | Full normalised report JSON | `KV_TTL_SECONDS` |
| `idx:{id}` | Pointer to primary key (O(1) lookups) | `KV_TTL_SECONDS` |

Inverted timestamp = `9999999999999 - Date.now()` so KV's lexicographic `list()` returns newest-first.

### D1 (`DB`)

| Table | Purpose |
|---|---|
| `properties` | One row per property (`default` + user-created) |
| `issues` | One row per `(property_id, fingerprint)` — count + status + denormalised fields for fast list views |
| `issue_events` | Per-issue rolling sample (capped at `EVENT_SAMPLE_CAP`) with country/ASN/colo |
| `issue_status_log` | Audit trail for status transitions, including `system:resurrection` |
| `_migrations` | Tracks applied migrations |

Schema in `migrations/0001_init.sql` (and mirrored in `src/migrations.ts` for runtime).

## Development

```bash
npm run dev               # wrangler dev (worker)
npm run dev:dashboard     # vite dev server (proxies API calls to wrangler dev)
npm test                  # vitest with @cloudflare/vitest-pool-workers (real KV + D1 via miniflare)
npm run typecheck         # tsc + svelte-check
npm run build:dashboard   # vite build → dist/
npm run deploy            # build:dashboard + wrangler deploy
```

Tests run inside `workerd` via [`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/) — KV and D1 are real bindings backed by miniflare, no mocks. Vitest reads bindings from `wrangler.test.toml` (checked in, placeholder IDs only) so production `wrangler.toml` stays free of test-only entries.

## Project layout

```
csp-report-worker/
├── src/
│   ├── index.ts           # Worker entry — Hono router, scheduled handler
│   ├── ingest.ts          # Parse + normalise both CSP report formats
│   ├── classify.ts        # 9-category source classifier
│   ├── dedup.ts           # SHA-256 fingerprint
│   ├── store.ts           # KV raw-report read/write
│   ├── db.ts              # D1 client + migration runner (idempotent, cached)
│   ├── migrations.ts      # Schema, mirror of migrations/0001_init.sql
│   ├── properties.ts      # Property CRUD + slug routing + token check + env seed
│   ├── properties-api.ts  # /properties HTTP handlers
│   ├── issues.ts          # Issue upsert + status transitions + read queries
│   ├── issues-api.ts      # /issues HTTP handlers
│   ├── policy.ts          # CSP policy assistant — pure functions
│   ├── policy-api.ts      # /properties/:id/policy-* handlers
│   ├── cf.ts              # Cloudflare context extraction (no IP)
│   ├── ua.ts              # Browser-family classifier for the breakdown panel
│   ├── maintenance.ts     # Cron: retention sweep
│   ├── api.ts             # Legacy /reports HTTP handlers (KV-backed)
│   ├── auth.ts            # Bearer token check
│   ├── config.ts          # Env-var parsing
│   ├── notify/            # Email + webhook + formatters (per-property aware)
│   └── types.ts           # Shared TS types
├── dashboard/             # Svelte 5 SPA (Vite, Tailwind v4, bits-ui)
├── migrations/            # SQL DDL files (mirror of src/migrations.ts)
├── test/                  # Vitest suites
├── wrangler-example.toml  # Template — copy to wrangler.toml
├── wrangler.test.toml     # Test-only bindings (placeholder IDs, miniflare-managed)
└── LICENSE                # GPL-3.0-or-later
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
