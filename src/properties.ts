/**
 * Property model — D1 read/write for the multi-property concept.
 *
 * Properties carry per-property notification overrides (emails, webhooks,
 * mute categories). Ingest is scoped via `POST /r/{slug}?t={token}`; legacy
 * `/report` falls through to the synthetic `default` property.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env, Property } from "./types";

const DEFAULT_ID = "default";
const DEFAULT_SLUG = "default";
const DEFAULT_NAME = "Default";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

interface PropertyRow {
  id: string;
  slug: string;
  name: string;
  ingest_token: string;
  notify_emails: string | null;
  notify_webhooks: string | null;
  mute_categories: string | null;
  created_at: string;
  archived_at: string | null;
}

function rowToProperty(r: PropertyRow): Property {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    ingestToken: r.ingest_token,
    notifyEmails: r.notify_emails,
    notifyWebhooks: r.notify_webhooks,
    muteCategories: r.mute_categories,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
  };
}

function generateToken(): string {
  return crypto.randomUUID();
}

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Insert the synthetic `default` property if it doesn't exist.
 * Acts as the catch-all for legacy `/report` and `/report/csp` traffic.
 */
export async function ensureDefaultProperty(db: D1Database): Promise<Property> {
  const existing = await db
    .prepare("SELECT * FROM properties WHERE id = ?")
    .bind(DEFAULT_ID)
    .first<PropertyRow>();

  if (existing) return rowToProperty(existing);

  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO properties (id, slug, name, ingest_token, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(DEFAULT_ID, DEFAULT_SLUG, DEFAULT_NAME, "", now)
    .run();

  return {
    id: DEFAULT_ID,
    slug: DEFAULT_SLUG,
    name: DEFAULT_NAME,
    ingestToken: "",
    notifyEmails: null,
    notifyWebhooks: null,
    muteCategories: null,
    createdAt: now,
    archivedAt: null,
  };
}

export async function getPropertyBySlug(
  db: D1Database,
  slug: string,
): Promise<Property | null> {
  const row = await db
    .prepare("SELECT * FROM properties WHERE slug = ? AND archived_at IS NULL")
    .bind(slug)
    .first<PropertyRow>();
  return row ? rowToProperty(row) : null;
}

export async function getPropertyById(
  db: D1Database,
  id: string,
): Promise<Property | null> {
  const row = await db
    .prepare("SELECT * FROM properties WHERE id = ?")
    .bind(id)
    .first<PropertyRow>();
  return row ? rowToProperty(row) : null;
}

export async function listProperties(
  db: D1Database,
  opts: { includeArchived?: boolean } = {},
): Promise<Property[]> {
  const sql = opts.includeArchived
    ? "SELECT * FROM properties ORDER BY archived_at IS NOT NULL, created_at DESC"
    : "SELECT * FROM properties WHERE archived_at IS NULL ORDER BY created_at DESC";
  const result = await db.prepare(sql).all<PropertyRow>();
  return (result.results ?? []).map(rowToProperty);
}

export interface CreatePropertyInput {
  slug: string;
  name: string;
  notifyEmails?: string | null;
  notifyWebhooks?: string | null;
  muteCategories?: string | null;
}

export class InvalidSlugError extends Error {
  constructor() {
    super(
      "slug must be 1-63 chars, lowercase a-z / 0-9 / -, starting with a letter or digit",
    );
  }
}

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`slug "${slug}" already exists`);
  }
}

export function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new InvalidSlugError();
}

export async function createProperty(
  db: D1Database,
  input: CreatePropertyInput,
): Promise<Property> {
  validateSlug(input.slug);

  const existing = await db
    .prepare("SELECT id FROM properties WHERE slug = ?")
    .bind(input.slug)
    .first();
  if (existing) throw new SlugTakenError(input.slug);

  const id = generateId();
  const token = generateToken();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO properties (id, slug, name, ingest_token, notify_emails, notify_webhooks, mute_categories, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.slug,
      input.name,
      token,
      input.notifyEmails ?? null,
      input.notifyWebhooks ?? null,
      input.muteCategories ?? null,
      now,
    )
    .run();

  return {
    id,
    slug: input.slug,
    name: input.name,
    ingestToken: token,
    notifyEmails: input.notifyEmails ?? null,
    notifyWebhooks: input.notifyWebhooks ?? null,
    muteCategories: input.muteCategories ?? null,
    createdAt: now,
    archivedAt: null,
  };
}

export interface UpdatePropertyInput {
  name?: string;
  notifyEmails?: string | null;
  notifyWebhooks?: string | null;
  muteCategories?: string | null;
}

export async function updateProperty(
  db: D1Database,
  id: string,
  input: UpdatePropertyInput,
): Promise<Property | null> {
  const existing = await getPropertyById(db, id);
  if (!existing) return null;

  const next: Property = {
    ...existing,
    name: input.name ?? existing.name,
    notifyEmails: input.notifyEmails === undefined ? existing.notifyEmails : input.notifyEmails,
    notifyWebhooks:
      input.notifyWebhooks === undefined ? existing.notifyWebhooks : input.notifyWebhooks,
    muteCategories:
      input.muteCategories === undefined ? existing.muteCategories : input.muteCategories,
  };

  await db
    .prepare(
      "UPDATE properties SET name = ?, notify_emails = ?, notify_webhooks = ?, mute_categories = ? WHERE id = ?",
    )
    .bind(
      next.name,
      next.notifyEmails,
      next.notifyWebhooks,
      next.muteCategories,
      id,
    )
    .run();

  return next;
}

export async function rotateIngestToken(
  db: D1Database,
  id: string,
): Promise<Property | null> {
  const existing = await getPropertyById(db, id);
  if (!existing) return null;
  if (id === DEFAULT_ID) return existing; // default never has a token

  const token = generateToken();
  await db.prepare("UPDATE properties SET ingest_token = ? WHERE id = ?").bind(token, id).run();
  return { ...existing, ingestToken: token };
}

export async function archiveProperty(
  db: D1Database,
  id: string,
): Promise<Property | null> {
  if (id === DEFAULT_ID) return null; // refuse to archive default
  const existing = await getPropertyById(db, id);
  if (!existing || existing.archivedAt) return existing;
  const now = new Date().toISOString();
  await db.prepare("UPDATE properties SET archived_at = ? WHERE id = ?").bind(now, id).run();
  return { ...existing, archivedAt: now };
}

/**
 * Resolve which property an incoming request is for.
 *
 *   /report, /report/csp        → default property
 *   /r/{slug}?t={token}         → property keyed by slug, with token check
 *
 * Returns the property on success, or a Response (401/404) on failure.
 */
export async function resolvePropertyForRequest(
  db: D1Database,
  request: Request,
  routeParams: { slug?: string } = {},
): Promise<Property | Response> {
  if (!routeParams.slug) {
    return ensureDefaultProperty(db);
  }

  const property = await getPropertyBySlug(db, routeParams.slug);
  if (!property) {
    return new Response(JSON.stringify({ error: "Property not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const provided = url.searchParams.get("t") || request.headers.get("x-ingest-token") || "";
  if (!provided || provided !== property.ingestToken) {
    return new Response(JSON.stringify({ error: "Invalid ingest token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return property;
}

interface BootstrapEntry {
  slug: string;
  name: string;
  emails?: string;
  webhooks?: string;
  muteCategories?: string;
}

let seedRan = false;

/** Per-isolate cache so seedFromEnv runs at most once per cold start. */
export async function ensureSeeded(db: D1Database, env: Env): Promise<void> {
  if (seedRan) return;
  await seedFromEnv(db, env);
  seedRan = true;
}

/** Test-only — reset the seed cache for clean isolation. */
export function _resetSeedCache(): void {
  seedRan = false;
}

/**
 * Seed properties from the BOOTSTRAP_PROPERTIES env var when the table is empty.
 *
 * The var is a JSON list of `{slug, name, emails?, webhooks?, muteCategories?}`.
 * Tokens are generated automatically. Run-once: if any non-default property
 * already exists, the seed is skipped.
 */
export async function seedFromEnv(db: D1Database, env: Env): Promise<void> {
  const raw = env.BOOTSTRAP_PROPERTIES?.trim();
  if (!raw) return;

  const existing = await db
    .prepare("SELECT COUNT(*) AS n FROM properties WHERE id != ?")
    .bind(DEFAULT_ID)
    .first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return;

  let entries: BootstrapEntry[];
  try {
    entries = JSON.parse(raw) as BootstrapEntry[];
  } catch (err) {
    console.error("[properties] BOOTSTRAP_PROPERTIES is not valid JSON:", err);
    return;
  }
  if (!Array.isArray(entries)) {
    console.error("[properties] BOOTSTRAP_PROPERTIES must be an array");
    return;
  }

  for (const entry of entries) {
    if (!entry?.slug || !entry?.name) continue;
    try {
      await createProperty(db, {
        slug: entry.slug,
        name: entry.name,
        notifyEmails: entry.emails ?? null,
        notifyWebhooks: entry.webhooks ?? null,
        muteCategories: entry.muteCategories ?? null,
      });
    } catch (err) {
      console.error(`[properties] Failed to seed slug "${entry.slug}":`, err);
    }
  }
}
