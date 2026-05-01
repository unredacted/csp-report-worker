/**
 * csp-report-worker — Cloudflare Worker entrypoint and router.
 *
 * Accepts CSP violation reports, deduplicates, stores in KV,
 * and forwards notifications via webhooks and email.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Context, Next } from "hono";
import type { Env, NormalisedReport } from "./types";
import { getAllowedOrigins, getDedupWindowMinutes, getKvNamespace, getKvTtlSeconds } from "./config";
import { parseRequest } from "./ingest";
import { computeFingerprint, isDuplicate, recordDedup } from "./dedup";
import { storeReport } from "./store";
import { dispatchNotifications, shouldNotify } from "./notify/index";
import { handleListReports, handleGetReport } from "./api";
import { requireAuth } from "./auth";

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

app.post("/report", (c) => handleReportIngestion(c.req.raw, c.env, c.executionCtx));
app.post("/report/csp", (c) => handleReportIngestion(c.req.raw, c.env, c.executionCtx));

app.get("/reports", authMiddleware, (c) => handleListReports(c.req.raw, c.env));
app.get("/reports/:id{[a-f0-9]+}", authMiddleware, (c) =>
  handleGetReport(c.req.raw, c.env, c.req.param("id")!),
);

app.notFound((c) =>
  c.json({ error: "Not found" }, 404),
);

export default app;

// ---------------------------------------------------------------------------
// Report ingestion handler
// ---------------------------------------------------------------------------

async function handleReportIngestion(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // --- Origin check (CORS middleware allows the request through; we still
  // reject unknown origins explicitly so reports are only accepted from
  // configured sites) ---
  const originError = checkOrigin(request, env);
  if (originError) return originError;

  // --- Parse + normalise ---
  let reports: NormalisedReport[];
  try {
    reports = await parseRequest(request);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[ingest] Unexpected parse error:", err);
    return new Response("Internal error", { status: 500 });
  }

  const dedupWindow = getDedupWindowMinutes(env);
  const kvTtl = getKvTtlSeconds(env);
  const workerUrl = new URL(request.url).origin;

  // --- Process each report ---
  for (const report of reports) {
    // Always store the report regardless of dedup status
    const fallbackKv = getKvNamespace(env);
    ctx.waitUntil(storeReport(fallbackKv, report, kvTtl));

    // Check dedup and dispatch notifications for new violations
    ctx.waitUntil(
      (async () => {
        try {
          const fingerprint = await computeFingerprint(report);
          const dupe = await isDuplicate(fallbackKv, fingerprint);

          // Record dedup entry (creates or increments)
          await recordDedup(fallbackKv, fingerprint, dedupWindow);

          if (!dupe && shouldNotify(env, report)) {
            // First occurrence and not muted — notify
            await dispatchNotifications(env, report, workerUrl);
          }
        } catch (err) {
          console.error("[ingest] Error in dedup/notify pipeline:", err);
        }
      })(),
    );
  }

  // Browsers expect 204 and don't read the body
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
