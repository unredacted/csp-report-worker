/**
 * csp-report-worker — Cloudflare Worker entrypoint and router.
 *
 * Accepts CSP violation reports, deduplicates, stores in KV,
 * and forwards notifications via webhooks and email.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env, NormalisedReport } from "./types";
import { getAllowedOrigins, getDedupWindowMinutes, getKvNamespace, getKvTtlSeconds } from "./config";
import { parseRequest } from "./ingest";
import { computeFingerprint, isDuplicate, recordDedup } from "./dedup";
import { storeReport } from "./store";
import { dispatchNotifications } from "./notify/index";
import { handleListReports, handleGetReport } from "./api";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // --- Health check ---
    if (path === "/health" && method === "GET") {
      return new Response(null, { status: 204 });
    }

    // --- CORS preflight for report endpoints ---
    if (method === "OPTIONS" && (path === "/report" || path === "/report/csp")) {
      return handleCorsPreflightResponse(request, env);
    }

    // --- Report ingestion ---
    if (method === "POST" && (path === "/report" || path === "/report/csp")) {
      return handleReportIngestion(request, env, ctx);
    }

    // --- API: List reports ---
    if (path === "/reports" && method === "GET") {
      return handleListReports(request, env);
    }

    // --- API: Get single report ---
    const reportMatch = path.match(/^\/reports\/([a-f0-9]+)$/);
    if (reportMatch && method === "GET") {
      return handleGetReport(request, env, reportMatch[1]!);
    }

    // --- 404 ---
    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  },
};

// ---------------------------------------------------------------------------
// Report ingestion handler
// ---------------------------------------------------------------------------

async function handleReportIngestion(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // --- Origin check ---
  const originError = checkOrigin(request, env);
  if (originError) return originError;

  // --- Parse + normalise ---
  let reports: NormalisedReport[];
  try {
    reports = await parseRequest(request, env);
  } catch (err) {
    if (err instanceof Response) return addCorsHeaders(err, request, env);
    console.error("[ingest] Unexpected parse error:", err);
    return addCorsHeaders(
      new Response("Internal error", { status: 500 }),
      request,
      env,
    );
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

          if (!dupe) {
            // First occurrence — notify
            await dispatchNotifications(env, report, workerUrl);
          }
        } catch (err) {
          console.error("[ingest] Error in dedup/notify pipeline:", err);
        }
      })(),
    );
  }

  // Browsers expect 204 and don't read the body
  return addCorsHeaders(new Response(null, { status: 204 }), request, env);
}

// ---------------------------------------------------------------------------
// Origin validation
// ---------------------------------------------------------------------------

function checkOrigin(request: Request, env: Env): Response | null {
  const allowedOrigins = getAllowedOrigins(env);
  if (!allowedOrigins) return null; // Accept all

  const origin = request.headers.get("origin") || "";
  if (!origin || allowedOrigins.includes(origin)) return null;

  return addCorsHeaders(
    new Response(
      JSON.stringify({ error: "Origin not allowed" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    ),
    request,
    env,
  );
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function handleCorsPreflightResponse(request: Request, env: Env): Response {
  return addCorsHeaders(
    new Response(null, { status: 204 }),
    request,
    env,
    true,
  );
}

function addCorsHeaders(
  response: Response,
  request: Request,
  env: Env,
  isPreflight = false,
): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin") || "*";

  const allowedOrigins = getAllowedOrigins(env);
  if (allowedOrigins) {
    // Reflect origin if it's in the allow list
    headers.set(
      "Access-Control-Allow-Origin",
      allowedOrigins.includes(origin) ? origin : allowedOrigins[0]!,
    );
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  if (isPreflight) {
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
