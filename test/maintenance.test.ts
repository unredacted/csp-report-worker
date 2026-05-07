/**
 * Tests for the scheduled retention sweep.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { runMigrations, _resetMigrationCache } from "../src/db";
import { ensureDefaultProperty } from "../src/properties";
import { computeFingerprint } from "../src/dedup";
import { upsertIssue } from "../src/issues";
import { runRetentionSweep } from "../src/maintenance";
import type { Env, NormalisedReport } from "../src/types";

const getDb = (): D1Database => (env as unknown as Env).DB!;

async function freshDb(): Promise<void> {
  for (const t of ["issue_status_log", "issue_events", "issues", "properties", "_migrations"]) {
    await getDb().prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }
  _resetMigrationCache();
  await runMigrations(getDb());
}

function makeReport(overrides?: Partial<NormalisedReport>): NormalisedReport {
  return {
    id: "abc123",
    timestamp: "2026-01-01T00:00:00.000Z",
    documentUri: "https://example.com/page",
    blockedUri: "https://evil.com/script.js",
    violatedDirective: "script-src",
    effectiveDirective: "script-src",
    originalPolicy: "script-src 'self'",
    disposition: "enforce",
    referrer: "",
    sourceFile: "https://example.com/page",
    lineNumber: 12,
    columnNumber: 34,
    statusCode: 200,
    userAgent: "TestAgent/1.0",
    sourceFormat: "report-uri",
    category: "external",
    ...overrides,
  };
}

async function makeIssueWithLastSeen(lastSeen: string, slug: string): Promise<string> {
  const property = await ensureDefaultProperty(getDb());
  const report = makeReport({ blockedUri: `https://${slug}.example/x.js` });
  const fp = await computeFingerprint(report);
  const r = await upsertIssue(getDb(), property, report, fp);
  await getDb()
    .prepare("UPDATE issues SET last_seen = ? WHERE id = ?")
    .bind(lastSeen, r.issueId)
    .run();
  return r.issueId;
}

describe("runRetentionSweep", () => {
  beforeEach(freshDb);

  it("does nothing when RETENTION_DAYS = 0", async () => {
    await makeIssueWithLastSeen("2020-01-01T00:00:00.000Z", "old");
    const r = await runRetentionSweep(getDb(), { RETENTION_DAYS: "0" } as unknown as Env);
    expect(r.deletedIssues).toBe(0);
    expect(r.cutoff).toBeNull();

    const count = await getDb()
      .prepare("SELECT COUNT(*) AS n FROM issues")
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("deletes issues older than the cutoff", async () => {
    const oldId = await makeIssueWithLastSeen("2020-01-01T00:00:00.000Z", "old");
    const freshId = await makeIssueWithLastSeen(new Date().toISOString(), "fresh");

    const r = await runRetentionSweep(
      getDb(),
      { RETENTION_DAYS: "30" } as unknown as Env,
    );
    expect(r.deletedIssues).toBe(1);

    const remaining = await getDb()
      .prepare("SELECT id FROM issues")
      .all<{ id: string }>();
    const remainingIds = (remaining.results ?? []).map((r) => r.id);
    expect(remainingIds).toEqual([freshId]);
    expect(remainingIds).not.toContain(oldId);
  });

  it("cascades to issue_events and issue_status_log", async () => {
    const property = await ensureDefaultProperty(getDb());
    const report = makeReport();
    const fp = await computeFingerprint(report);
    const r = await upsertIssue(getDb(), property, report, fp);

    // Stamp a status-log row + an event so we can verify the cascade.
    await getDb()
      .prepare(
        "INSERT INTO issue_status_log (issue_id, from_status, to_status, actor, at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(r.issueId, "open", "acknowledged", "user:test", new Date().toISOString())
      .run();
    await getDb()
      .prepare(
        "INSERT INTO issue_events (issue_id, report_id, ts) VALUES (?, ?, ?)",
      )
      .bind(r.issueId, report.id, new Date().toISOString())
      .run();

    // Backdate the issue so retention deletes it.
    await getDb()
      .prepare("UPDATE issues SET last_seen = ? WHERE id = ?")
      .bind("2020-01-01T00:00:00.000Z", r.issueId)
      .run();

    await runRetentionSweep(getDb(), { RETENTION_DAYS: "30" } as unknown as Env);

    const events = await getDb()
      .prepare("SELECT COUNT(*) AS n FROM issue_events WHERE issue_id = ?")
      .bind(r.issueId)
      .first<{ n: number }>();
    expect(events?.n).toBe(0);

    const logs = await getDb()
      .prepare("SELECT COUNT(*) AS n FROM issue_status_log WHERE issue_id = ?")
      .bind(r.issueId)
      .first<{ n: number }>();
    expect(logs?.n).toBe(0);
  });

  it("uses the default 90-day retention when RETENTION_DAYS is unset", async () => {
    // 100 days ago — past 90-day default
    const past = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    await makeIssueWithLastSeen(past, "stale");

    const r = await runRetentionSweep(getDb(), {} as unknown as Env);
    expect(r.deletedIssues).toBe(1);
    expect(r.cutoff).not.toBeNull();
  });
});
