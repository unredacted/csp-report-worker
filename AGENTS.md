# AGENTS.md — Guidelines for AI Agents

This document describes conventions, architecture, and rules that AI coding agents must follow when working on this project.

## Project Overview

**csp-report-worker** is a Cloudflare Worker that accepts Content Security Policy (CSP) violation reports from browsers, deduplicates them, stores them in Workers KV, and forwards notifications via webhooks and Cloudflare Email Workers.

It supports both the legacy `report-uri` format (`application/csp-report`) and the modern Reporting API v1 `report-to` format (`application/reports+json`).

## Technology Stack

- **Runtime:** Cloudflare Workers (`workerd`)
- **Language:** TypeScript (strict mode)
- **Build/Deploy:** Wrangler v4+
- **Storage:** Cloudflare Workers KV
- **Email:** Pluggable — Mailgun, AWS SES, Resend, or Cloudflare Send Email Workers
- **AWS SigV4 signing:** `aws4fetch` (edge-native, zero `node:*` imports)
- **MIME construction:** `mimetext` (browser build — see import note below, used by Cloudflare provider only)
- **Testing:** Vitest with `@cloudflare/vitest-pool-workers` (runs in `workerd`)
- **License:** GPL-3.0-or-later

## Critical Rules

### No `node:*` imports in production code

The Worker runs in the `workerd` runtime, not Node.js. Do not import from `node:` modules. The `nodejs_compat` flag is enabled but should only be relied on as a last resort.

**`mimetext` must be imported from `mimetext/browser`**, not `mimetext`. The default entrypoint imports `node:os` which fails in workerd.

```typescript
// ✅ Correct
import { createMimeMessage } from "mimetext/browser";

// ❌ Wrong — will fail at runtime
import { createMimeMessage } from "mimetext";
```

### `wrangler.toml` is gitignored

The real `wrangler.toml` contains deployment-specific configuration (KV namespace IDs, notification targets, etc.) and is excluded from version control. **`wrangler-example.toml`** is the committed template.

When adding new environment variables or bindings:
1. Add the variable to `wrangler-example.toml` with a placeholder value
2. Add the variable to the `Env` interface in `src/types.ts`
3. Add a parser/default in `src/config.ts` if the variable needs runtime parsing
4. Document the variable in `README.md` under the Quick Start section
5. Never commit real secrets or namespace IDs

### Secrets vs vars

| Type | Where | Example |
|------|-------|---------|
| `[vars]` in wrangler.toml | Non-secret configuration | `DEDUP_WINDOW_MINUTES`, `NOTIFY_EMAILS`, `EMAIL_PROVIDER` |
| `wrangler secret put` | Sensitive values | `API_TOKEN`, `MAILGUN_API_KEY`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`, `RESEND_API_KEY` |

Secrets are accessed identically via `env.SECRET_NAME` but are never stored in config files.

### All POST endpoints return 204

Browsers sending CSP reports expect `204 No Content` and do not read the response body. Never return a body on `/report` or `/report/csp` POST responses.

### Background work uses `ctx.waitUntil()`

The 204 response must be returned to the browser immediately. All KV writes, dedup checks, and notification dispatch happen asynchronously via `ctx.waitUntil()`. This is not optional — CSP reporting endpoints must be fast.

### CORS is required for `report-to`

The Reporting API v1 (`report-to`) triggers CORS preflights. The `OPTIONS` handler on `/report` and `/report/csp` must return:
- `Access-Control-Allow-Origin` (reflect origin or `*`)
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`
- `Access-Control-Max-Age: 86400`

## Architecture

### Request Flow

```
POST /report → parseRequest() → for each report:
  ├── storeReport()           [ctx.waitUntil — always]
  └── computeFingerprint()
      ├── isDuplicate? → recordDedup() [increment count]
      └── new? → recordDedup() + dispatchNotifications() [ctx.waitUntil]
→ return 204
```

### Module Responsibilities

| Module | Responsibility | Key constraint |
|--------|---------------|----------------|
| `src/index.ts` | Router + CORS + origin check | Must return 204 immediately for POST |
| `src/ingest.ts` | Parse both report formats, normalise | Reject bodies > 64 KB |
| `src/dedup.ts` | Fingerprint + KV dedup window | SHA-256 via Web Crypto API only |
| `src/store.ts` | KV read/write | Inverted-timestamp keys (see below) |
| `src/notify/` | Email + webhook dispatch | Fire-and-forget, catch all errors |
| `src/notify/provider.ts` | Email provider interface + factory | Lazy imports for inactive providers |
| `src/auth.ts` | Bearer token validation | Constant-time comparison |
| `src/api.ts` | GET endpoints | Always call `requireAuth()` first |
| `src/config.ts` | Env var parsing + dynamic KV resolution | Provide safe defaults; locate KV automatically |
| `src/types.ts` | Shared interfaces | Single source of truth for Env |

### KV Key Design

Keys use **inverted timestamps** so KV's lexicographic `list()` returns newest-first:

```
report:{9999999999999 - Date.now()}:{id}   → full report JSON
idx:{id}                                    → pointer to report key
dedup:{fingerprint}                         → { count, firstSeen }
```

The ceiling constant `9999999999999` is defined in `src/config.ts` as `INVERTED_TS_CEILING`. Do not hardcode it elsewhere.

When adding new KV key patterns:
- Document the key format in this section
- Use a unique prefix to avoid collisions
- Always set a TTL (no permanent keys unless justified)

### Normalised Report Schema

All reports are normalised to the `NormalisedReport` interface in `src/types.ts`. If you need to add fields:
1. Add the field to `NormalisedReport`
2. Populate it in both `normaliseLegacy()` and `normaliseReportingApi()` in `src/ingest.ts`
3. Update the fingerprint computation in `src/dedup.ts` **only** if the new field should affect dedup grouping
4. Update formatters in `src/notify/format.ts`

### Deduplication Fingerprint

```
SHA-256(blockedUri | violatedDirective | documentUri | sourceFile:lineNumber)
```

This groups reports describing the **same violation on the same page from the same source location**. Changes to the fingerprint fields will change dedup behaviour — be careful.

## Testing

### Test runner

Tests run inside `workerd` via `@cloudflare/vitest-pool-workers`. This provides real KV bindings (Miniflare) — no mocking needed for KV operations.

### Test environment types

The `env.d.ts` file at the project root extends `ProvidedEnv` from `cloudflare:test` with our `Env` interface. If you add new bindings, update both `src/types.ts` and `env.d.ts`.

### `ctx.waitUntil()` in tests

Tests that call the worker's `fetch` handler must use a mock `ExecutionContext` that **collects and awaits** all `waitUntil()` promises before asserting. This is required by the vitest-pool-workers isolated storage system.

```typescript
function mockCtx(): ExecutionContext & { flush(): Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(p: Promise<unknown>) { pending.push(p); },
    passThroughOnException() {},
    props: {},
    async flush() { await Promise.allSettled(pending); },
  } as unknown as ExecutionContext & { flush(): Promise<void> };
}

// In tests:
const ctx = mockCtx();
const res = await worker.fetch(req, testEnv(), ctx);
await ctx.flush(); // MUST call before asserting
expect(res.status).toBe(204);
```

### Report IDs in tests

Real report IDs are SHA-256 hex strings (`[a-f0-9]{64}`). The route regex for `GET /reports/:id` matches `[a-f0-9]+`. When creating test fixtures with custom IDs, use hex-only strings.

### Running tests

```bash
npm test           # vitest run
npm run test:watch # vitest (watch mode)
npm run typecheck  # tsc --noEmit
```

All tests must pass and TypeScript must compile cleanly before committing.

## Adding New Features

### New endpoint

1. Add the handler function in the appropriate module (`src/api.ts` for GET, or a new file)
2. Add the route in `src/index.ts`
3. If authenticated, call `requireAuth()` first
4. If it's a POST endpoint accepting reports, handle CORS preflight in `src/index.ts`
5. Add tests in `test/`

### New notification channel

1. Create `src/notify/<channel>.ts` following the pattern of `webhook.ts` or `email.ts`
2. Add the send function call in `src/notify/index.ts`
3. Add any new env vars to `Env`, `config.ts`, `wrangler-example.toml`, and `README.md`
4. Ensure the function catches all errors — notification failures must never crash the worker

### New email provider

1. Add the provider implementation inside `src/notify/provider.ts` as a `create<Name>Provider()` function
2. Add the provider name to the `EmailProviderType` union in `src/config.ts`
3. Add the new case to the `switch` in `createEmailProvider()` in `src/notify/provider.ts`
4. Add env vars to `Env`, `config.ts`, `wrangler-example.toml`, and `README.md`
5. Add tests in `test/email.test.ts`

### New environment variable

1. Add to `Env` interface in `src/types.ts`
2. Add parser with default in `src/config.ts`
3. Add to `wrangler-example.toml` with placeholder/default value
4. Document in `README.md`
5. If it's a secret, note that it uses `wrangler secret put`

## Code Style

- **License headers:** Every source file begins with a JSDoc comment including `SPDX-License-Identifier: GPL-3.0-or-later`
- **Error handling:** Notification dispatch functions catch all errors internally. Parse functions throw `Response` objects for HTTP error responses.
- **No hardcoded config:** All behaviour is driven by environment variables and bindings. Defaults live in `src/config.ts`.
- **Exports:** Each module exports only the functions needed by its callers. Keep internal helpers unexported.
