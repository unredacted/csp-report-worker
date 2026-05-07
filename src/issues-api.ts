/**
 * HTTP handlers for /issues and /issues/:id.
 *
 * Mirror of src/api.ts (the legacy /reports handlers); separated so the
 * issue-shaped queries stay close to src/issues.ts.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env, IssueStatus } from "./types";
import { getD1, ensureMigrations } from "./db";
import { ensureDefaultProperty } from "./properties";
import { getIssue, listIssues, setIssueStatus } from "./issues";
import { requireAuth } from "./auth";

const VALID_STATUSES: readonly IssueStatus[] = ["open", "acknowledged", "ignored", "resolved"];

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function requireDb(env: Env): Promise<D1Database | Response> {
  const db = getD1(env);
  if (!db) return jsonError(503, "D1 binding not configured");
  await ensureMigrations(db);
  await ensureDefaultProperty(db);
  return db;
}

export async function handleListIssues(request: Request, env: Env): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  const url = new URL(request.url);
  const propertyId = url.searchParams.get("property") || "default";
  const statusParam = url.searchParams.get("status") || "";
  const statuses = statusParam
    ? (statusParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => VALID_STATUSES.includes(s as IssueStatus)) as IssueStatus[])
    : undefined;
  const directive = url.searchParams.get("directive") || undefined;
  const limitParam = parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(limitParam) ? limitParam : undefined;
  const cursor = url.searchParams.get("cursor") || undefined;

  const result = await listIssues(db, { propertyId, statuses, directive, limit, cursor });
  return json(result);
}

export async function handleGetIssue(
  _request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  const detail = await getIssue(db, id);
  if (!detail) return jsonError(404, "Issue not found");
  return json(detail);
}

interface PatchBody {
  status?: string;
  reason?: string;
}

function actorForRequest(request: Request, env: Env): string {
  // Bearer token already validated by authMiddleware. Hash a prefix so logs
  // don't leak the token but stay attributable across multiple operators.
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!token) return "user:anonymous";
  // Cheap, non-cryptographic — only used for log attribution within one tenant.
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  // Keep env in scope to satisfy lint without re-reading any secrets.
  void env;
  return `user:${hash.toString(16).slice(0, 8)}`;
}

export async function handlePatchIssue(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  // Re-validate auth here so the actor attribution can read the bearer token.
  // (authMiddleware already passed before we got called, but we don't have
  // a typed accessor for the validated principal yet.)
  const authErr = requireAuth(request, env);
  if (authErr) return authErr;

  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const status = body.status as IssueStatus | undefined;
  if (!status || !VALID_STATUSES.includes(status)) {
    return jsonError(400, `status must be one of ${VALID_STATUSES.join(", ")}`);
  }

  const actor = actorForRequest(request, env);
  const result = await setIssueStatus(db, id, status, actor, body.reason);
  if (result == null) return jsonError(404, "Issue not found");

  const detail = await getIssue(db, id);
  return json(detail);
}
