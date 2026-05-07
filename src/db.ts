/**
 * D1 helpers — migration runner and binding lookup.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MIGRATIONS } from "./migrations";
import type { Env } from "./types";

/**
 * Locate the D1 binding. Conventional name is `DB`, but match by constructor
 * so users can rename the binding without touching code (mirrors the KV
 * lookup pattern in src/config.ts).
 */
export function getD1(env: Env): D1Database | null {
  for (const key of Object.keys(env)) {
    const val = env[key] as { constructor?: { name?: string } } | undefined;
    if (val?.constructor?.name === "D1Database") {
      return val as unknown as D1Database;
    }
  }
  return null;
}

/**
 * Apply any unrun migrations from src/migrations.ts.
 * Idempotent — safe to call on every cold start.
 */
export async function runMigrations(db: D1Database): Promise<void> {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    )
    .run();

  const applied = await db.prepare("SELECT name FROM _migrations").all<{ name: string }>();
  const appliedSet = new Set((applied.results ?? []).map((r) => r.name));

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.name)) continue;

    for (const statement of migration.statements) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      await db.prepare(trimmed).run();
    }

    await db
      .prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)")
      .bind(migration.name, new Date().toISOString())
      .run();
  }
}

/**
 * Per-cold-start guard so we don't re-check migrations on every request.
 * Safe across requests in the same isolate; new isolates re-check.
 */
let migrationsApplied = false;

export async function ensureMigrations(db: D1Database): Promise<void> {
  if (migrationsApplied) return;
  await runMigrations(db);
  migrationsApplied = true;
}

/** Test-only — reset the per-isolate cache so tests can re-apply migrations. */
export function _resetMigrationCache(): void {
  migrationsApplied = false;
}
