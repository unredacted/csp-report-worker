/**
 * csp-report-worker — Cloudflare Worker entrypoint and router.
 *
 * Accepts CSP violation reports, deduplicates, stores in KV,
 * and forwards notifications via webhooks and email.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import type { Env, NormalisedReport, Property } from "./types";
import {
  getAllowedOrigins,
  getEventSampleCap,
  getKvNamespace,
  getKvTtlSeconds,
  getResurrectionGraceHours,
} from "./config";
import { parseRequest } from "./ingest";
import { computeFingerprint } from "./dedup";
import { storeReport } from "./store";
import { dispatchNotifications, notifyKindForTransition } from "./notify/index";
import { handleListReports, handleGetReport } from "./api";
import {
  handleGetIssue,
  handleListIssues,
  handlePatchIssue,
} from "./issues-api";
import {
  handleArchiveProperty,
  handleCreateProperty,
  handleGetProperty,
  handleListProperties,
  handlePatchProperty,
  handleRotateToken,
} from "./properties-api";
import { handlePolicyPreview, handlePolicySuggestions } from "./policy-api";
import { requireAuth } from "./auth";
import { ensureMigrations, getD1 } from "./db";
import {
  ensureDefaultProperty,
  ensureSeeded,
  resolvePropertyForRequest,
} from "./properties";
import { insertEvent, markNotified, upsertIssue } from "./issues";
import { extractRequestContext } from "./cf";
import { runRetentionSweep } from "./maintenance";

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// CORS for report ingestion (Reporting API v1 sends preflight)
// ---------------------------------------------------------------------------

const corsForReports = cors({
  origin: (origin, c) => {
    const allowed = getAllowedOrigins(c.env);
    if (!allowed) return origin || "*";
    return allowed.includes(origin) ? origin : allowed[0]!;
  },
  allowMethods: ["POST", "OPTIONS"],
  allowHeaders: ["Content-Type"],
  maxAge: 86400,
});

app.use("/report", corsForReports);
app.use("/report/csp", corsForReports);
app.use("/r/*", corsForReports);

// ---------------------------------------------------------------------------
// Auth middleware for protected GET endpoints
// ---------------------------------------------------------------------------

async function authMiddleware(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const error = requireAuth(c.req.raw, c.env);
  if (error) return error;
  await next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/health", (c) => c.body(null, 204));

// Token validation endpoint for the SPA login flow. Returns 204 on a valid
// Bearer token, otherwise the auth middleware's standard 401/403/503.
// Has no side effects — does not list, fetch, or modify any data.
app.get("/auth/check", authMiddleware, (c) => c.body(null, 204));

app.post("/report", (c) => handleDefaultIngestion(c.req.raw, c.env, c.executionCtx));
app.post("/report/csp", (c) => handleDefaultIngestion(c.req.raw, c.env, c.executionCtx));
app.post("/r/:slug", (c) =>
  handleSlugIngestion(c.req.raw, c.env, c.executionCtx, c.req.param("slug")!),
);

app.get("/reports", authMiddleware, (c) => handleListReports(c.req.raw, c.env));
app.get("/reports/:id{[a-f0-9]+}", authMiddleware, (c) =>
  handleGetReport(c.req.raw, c.env, c.req.param("id")!),
);

app.get("/issues", authMiddleware, (c) => handleListIssues(c.req.raw, c.env));
app.get("/issues/:id", authMiddleware, (c) =>
  handleGetIssue(c.req.raw, c.env, c.req.param("id")!),
);
app.patch("/issues/:id", authMiddleware, (c) =>
  handlePatchIssue(c.req.raw, c.env, c.req.param("id")!),
);

app.get("/properties", authMiddleware, (c) => handleListProperties(c.req.raw, c.env));
app.post("/properties", authMiddleware, (c) => handleCreateProperty(c.req.raw, c.env));
app.get("/properties/:id", authMiddleware, (c) =>
  handleGetProperty(c.req.raw, c.env, c.req.param("id")!),
);
app.patch("/properties/:id", authMiddleware, (c) =>
  handlePatchProperty(c.req.raw, c.env, c.req.param("id")!),
);
app.post("/properties/:id/rotate-token", authMiddleware, (c) =>
  handleRotateToken(c.req.raw, c.env, c.req.param("id")!),
);
app.post("/properties/:id/archive", authMiddleware, (c) =>
  handleArchiveProperty(c.req.raw, c.env, c.req.param("id")!),
);
app.get("/properties/:id/policy-suggestions", authMiddleware, (c) =>
  handlePolicySuggestions(c.req.raw, c.env, c.req.param("id")!),
);
app.post("/properties/:id/policy-preview", authMiddleware, (c) =>
  handlePolicyPreview(c.req.raw, c.env, c.req.param("id")!),
);

// Anything unmatched falls through to the dashboard SPA on GET/HEAD.
// Other methods get the existing JSON 404. When the ASSETS binding isn't
// configured (unit tests) the JSON 404 also applies.
app.notFound(async (c) => {
  const m = c.req.method;
  if ((m === "GET" || m === "HEAD") && c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ error: "Not found" }, 404);
});

export { app };

export default class CspReportWorker extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  /**
   * Cron-triggered maintenance. Configure in wrangler.toml under
   * `[triggers] crons = ["0 * * * *"]` (hourly) or similar.
   */
  override async scheduled(_controller: ScheduledController): Promise<void> {
    const db = getD1(this.env);
    if (!db) return;
    try {
      await ensureMigrations(db);
      const result = await runRetentionSweep(db, this.env);
      if (result.deletedIssues > 0) {
        console.log(
          `[scheduled] retention sweep deleted ${result.deletedIssues} issues older than ${result.cutoff}`,
        );
      }
    } catch (err) {
      console.error("[scheduled] retention sweep failed:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Report ingestion handler
// ---------------------------------------------------------------------------

/** Legacy `/report` and `/report/csp` ingest — attributes to the `default` property. */
async function handleDefaultIngestion(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const db = getD1(env);
  let property: Property | null = null;
  if (db) {
    await ensureMigrations(db);
    await ensureSeeded(db, env);
    property = await ensureDefaultProperty(db);
  }
  return processIngestion(request, env, ctx, property);
}

/** New `/r/{slug}?t={token}` ingest path — per-property routing. */
async function handleSlugIngestion(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  slug: string,
): Promise<Response> {
  const db = getD1(env);
  if (!db) {
    return new Response(JSON.stringify({ error: "D1 binding required for /r/:slug" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  await ensureMigrations(db);
  await ensureSeeded(db, env);

  const resolved = await resolvePropertyForRequest(db, request, { slug });
  if (resolved instanceof Response) return resolved;

  return processIngestion(request, env, ctx, resolved);
}

/** Shared ingest logic — origin check, parse, KV write, D1 upsert, notify. */
async function processIngestion(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  property: Property | null,
): Promise<Response> {
  const originError = checkOrigin(request, env);
  if (originError) return originError;

  let reports: NormalisedReport[];
  try {
    reports = await parseRequest(request);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[ingest] Unexpected parse error:", err);
    return new Response("Internal error", { status: 500 });
  }

  const kvTtl = getKvTtlSeconds(env);
  const workerUrl = new URL(request.url).origin;
  const fallbackKv = getKvNamespace(env);
  const db = getD1(env);
  const reqCtx = extractRequestContext(request);
  const eventCap = getEventSampleCap(env);
  const graceMs = getResurrectionGraceHours(env) * 60 * 60 * 1000;

  for (const report of reports) {
    ctx.waitUntil(storeReport(fallbackKv, report, kvTtl));

    if (db && property) {
      ctx.waitUntil(
        (async () => {
          try {
            const fingerprint = await computeFingerprint(report);
            const result = await upsertIssue(db, property, report, fingerprint, graceMs);
            await insertEvent(db, result.issueId, report, reqCtx, eventCap);

            const kind = notifyKindForTransition(
              env,
              result.transition,
              report.category,
              property,
            );
            if (kind) {
              await dispatchNotifications(
                env,
                report,
                workerUrl,
                kind,
                property,
                result.issueId,
              );
              await markNotified(db, result.issueId);
            }
          } catch (err) {
            console.error("[ingest] Error in D1 issue pipeline:", err);
          }
        })(),
      );
    }
  }

  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Origin validation
// ---------------------------------------------------------------------------

function checkOrigin(request: Request, env: Env): Response | null {
  const allowedOrigins = getAllowedOrigins(env);
  if (!allowedOrigins) return null; // Accept all

  const origin = request.headers.get("origin") || "";
  if (!origin || allowedOrigins.includes(origin)) return null;

  return new Response(
    JSON.stringify({ error: "Origin not allowed" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}
