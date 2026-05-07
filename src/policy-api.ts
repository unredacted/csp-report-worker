/**
 * HTTP handlers for /properties/:id/policy-suggestions and /policy-preview.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env } from "./types";
import { ensureMigrations, getD1 } from "./db";
import { ensureDefaultProperty, getPropertyById } from "./properties";
import { renderPolicy, suggestPolicy, type PolicySelection } from "./policy";

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

export async function handlePolicySuggestions(
  _request: Request,
  env: Env,
  propertyId: string,
): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  const property = await getPropertyById(db, propertyId);
  if (!property) return jsonError(404, "Property not found");

  const suggestions = await suggestPolicy(db, propertyId);
  return json(suggestions);
}

interface PreviewBody {
  baseline?: string;
  selections?: PolicySelection[];
}

export async function handlePolicyPreview(
  request: Request,
  env: Env,
  propertyId: string,
): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  const property = await getPropertyById(db, propertyId);
  if (!property) return jsonError(404, "Property not found");

  let body: PreviewBody;
  try {
    body = (await request.json()) as PreviewBody;
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const baseline = (body.baseline ?? "").trim();
  const selections = Array.isArray(body.selections) ? body.selections : [];
  const policy = renderPolicy(baseline, selections);
  return json({ policy });
}
