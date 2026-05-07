/**
 * HTTP handlers for /properties admin endpoints.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env, Property } from "./types";
import { ensureMigrations, getD1 } from "./db";
import {
  archiveProperty,
  createProperty,
  ensureDefaultProperty,
  ensureSeeded,
  getPropertyById,
  InvalidSlugError,
  listProperties,
  rotateIngestToken,
  SlugTakenError,
  updateProperty,
} from "./properties";

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
  await ensureSeeded(db, env);
  return db;
}

/** Redact the ingest token in list/get responses — only show last 4 chars. */
function redactToken(p: Property): Omit<Property, "ingestToken"> & { ingestTokenSuffix: string } {
  const { ingestToken, ...rest } = p;
  return {
    ...rest,
    ingestTokenSuffix: ingestToken ? `…${ingestToken.slice(-4)}` : "",
  };
}

export async function handleListProperties(_request: Request, env: Env): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  const properties = await listProperties(db);
  return json({ properties: properties.map(redactToken) });
}

export async function handleCreateProperty(request: Request, env: Env): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  let body: { slug?: string; name?: string; emails?: string; webhooks?: string; muteCategories?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  if (!body.slug || !body.name) return jsonError(400, "slug and name are required");

  try {
    const property = await createProperty(db, {
      slug: body.slug,
      name: body.name,
      notifyEmails: body.emails ?? null,
      notifyWebhooks: body.webhooks ?? null,
      muteCategories: body.muteCategories ?? null,
    });
    // First-and-only time we expose the full token in a response.
    return json({ property }, 201);
  } catch (err) {
    if (err instanceof InvalidSlugError) return jsonError(400, err.message);
    if (err instanceof SlugTakenError) return jsonError(409, err.message);
    throw err;
  }
}

export async function handleGetProperty(
  _request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  const property = await getPropertyById(db, id);
  if (!property) return jsonError(404, "Property not found");
  return json({ property: redactToken(property) });
}

export async function handlePatchProperty(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  let body: { name?: string; emails?: string | null; webhooks?: string | null; muteCategories?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, "Invalid JSON");
  }

  const updated = await updateProperty(db, id, {
    name: body.name,
    notifyEmails: body.emails,
    notifyWebhooks: body.webhooks,
    muteCategories: body.muteCategories,
  });
  if (!updated) return jsonError(404, "Property not found");
  return json({ property: redactToken(updated) });
}

export async function handleRotateToken(
  _request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  const rotated = await rotateIngestToken(db, id);
  if (!rotated) return jsonError(404, "Property not found");
  // Expose the full token here — only time after creation.
  return json({ property: rotated });
}

export async function handleArchiveProperty(
  _request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const dbOrErr = await requireDb(env);
  if (dbOrErr instanceof Response) return dbOrErr;
  const db = dbOrErr;

  const archived = await archiveProperty(db, id);
  if (!archived) return jsonError(404, "Property not found or cannot be archived");
  return json({ property: redactToken(archived) });
}
