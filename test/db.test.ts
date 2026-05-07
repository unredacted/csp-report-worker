/**
 * Tests for the D1 migration runner.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { runMigrations, _resetMigrationCache, ensureMigrations, getD1 } from "../src/db";
import type { Env } from "../src/types";

const getDb = (): D1Database => (env as unknown as Env).DB!;

const TABLES = [
  "_migrations",
  "issue_status_log",
  "issue_events",
  "issues",
  "properties",
];

async function dropAll(db: D1Database): Promise<void> {
  for (const t of TABLES) {
    await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }
  _resetMigrationCache();
}

describe("runMigrations", () => {
  beforeEach(async () => {
    await dropAll(getDb());
  });

  it("creates all expected tables", async () => {
    await runMigrations(getDb());

    const result = await getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = (result.results ?? []).map((r) => r.name);

    for (const expected of [
      "properties",
      "issues",
      "issue_events",
      "issue_status_log",
      "_migrations",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("creates the expected indexes", async () => {
    await runMigrations(getDb());

    const result = await getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
    ).all<{ name: string }>();
    const names = (result.results ?? []).map((r) => r.name);

    expect(names).toContain("idx_issues_status_lastseen");
    expect(names).toContain("idx_issues_lastseen");
    expect(names).toContain("idx_events_issue_ts");
  });

  it("is idempotent — running twice does not error or duplicate", async () => {
    await runMigrations(getDb());
    // Second run must not throw and must leave _migrations with one row.
    await expect(runMigrations(getDb())).resolves.toBeUndefined();

    const count = await getDb().prepare("SELECT COUNT(*) AS n FROM _migrations").first<{
      n: number;
    }>();
    expect(count?.n).toBe(1);
  });

  it("records the migration name in _migrations", async () => {
    await runMigrations(getDb());
    const row = await getDb().prepare("SELECT name FROM _migrations").first<{ name: string }>();
    expect(row?.name).toBe("0001_init");
  });

  it("issue_events has no `ip` column (privacy guarantee)", async () => {
    await runMigrations(getDb());
    const cols = await getDb().prepare("PRAGMA table_info(issue_events)").all<{
      name: string;
    }>();
    const names = (cols.results ?? []).map((c) => c.name);
    expect(names).not.toContain("ip");
    expect(names).not.toContain("client_ip");
    expect(names).not.toContain("remote_addr");
  });
});

describe("ensureMigrations", () => {
  beforeEach(async () => {
    await dropAll(getDb());
  });

  it("applies migrations on first call", async () => {
    await ensureMigrations(getDb());
    const tables = await getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'issues'",
    ).first<{ name: string }>();
    expect(tables?.name).toBe("issues");
  });

  it("is a cached no-op on subsequent calls in the same isolate", async () => {
    await ensureMigrations(getDb());

    // Manually drop the marker row to prove the cache short-circuits the SQL path.
    await getDb().prepare("DELETE FROM _migrations").run();

    await ensureMigrations(getDb());

    // The cache means we did NOT re-apply migrations — _migrations stays empty.
    const count = await getDb().prepare("SELECT COUNT(*) AS n FROM _migrations").first<{
      n: number;
    }>();
    expect(count?.n).toBe(0);
  });
});

describe("getD1", () => {
  it("locates the D1 binding by constructor name", () => {
    const db = getD1(env as unknown as Env);
    expect(db).not.toBeNull();
    expect(typeof db?.prepare).toBe("function");
  });

  it("returns null when no D1 binding is present", () => {
    const stripped = { ...(env as object) } as Record<string, unknown>;
    for (const k of Object.keys(stripped)) {
      const v = stripped[k] as { constructor?: { name?: string } } | undefined;
      if (v?.constructor?.name === "D1Database") delete stripped[k];
    }
    expect(getD1(stripped as unknown as Env)).toBeNull();
  });
});
