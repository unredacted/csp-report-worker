/**
 * API handlers — GET endpoints for reading stored reports.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env } from "./types";
import { requireAuth } from "./auth";
import { getReport, listReports } from "./store";

/**
 * Handle GET /reports — list recent reports with pagination and filtering.
 */
export async function handleListReports(
  request: Request,
  env: Env,
): Promise<Response> {
  const authError = requireAuth(request, env);
  if (authError) return authError;

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);
  const cursor = url.searchParams.get("cursor") || undefined;
  const directive = url.searchParams.get("directive") || undefined;

  const result = await listReports(env.CSP_REPORTS, {
    limit: Number.isFinite(limit) ? limit : 50,
    cursor,
    directive,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Handle GET /reports/:id — fetch a single report by ID.
 */
export async function handleGetReport(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const authError = requireAuth(request, env);
  if (authError) return authError;

  const report = await getReport(env.CSP_REPORTS, id);

  if (!report) {
    return new Response(
      JSON.stringify({ error: "Report not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify(report), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
