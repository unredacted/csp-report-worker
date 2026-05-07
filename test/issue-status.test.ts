/**
 * Tests for setIssueStatus — manual triage transitions + audit log.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { runMigrations, _resetMigrationCache } from "../src/db";
import { ensureDefaultProperty } from "../src/properties";
import { computeFingerprint } from "../src/dedup";
import { setIssueStatus, upsertIssue } from "../src/issues";
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

async function makeIssue(): Promise<string> {
  const property = await ensureDefaultProperty(getDb());
  const report = makeReport();
  const fp = await computeFingerprint(report);
  const r = await upsertIssue(getDb(), property, report, fp);
  return r.issueId;
}

describe("setIssueStatus", () => {
  beforeEach(freshDb);

  it("transitions open → acknowledged and writes a log row", async () => {
    const id = await makeIssue();
    const result = await setIssueStatus(getDb(), id, "acknowledged", "user:abc");
    expect(result).toBe("acknowledged");

    const row = await getDb()
      .prepare("SELECT status FROM issues WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe("acknowledged");

    const log = await getDb()
      .prepare("SELECT from_status, to_status, actor FROM issue_status_log WHERE issue_id = ?")
      .bind(id)
      .first<{ from_status: string; to_status: string; actor: string }>();
    expect(log?.from_status).toBe("open");
    expect(log?.to_status).toBe("acknowledged");
    expect(log?.actor).toBe("user:abc");
  });

  it("stamps resolved_at when transitioning to resolved", async () => {
    const id = await makeIssue();
    await setIssueStatus(getDb(), id, "resolved", "user:abc");

    const row = await getDb()
      .prepare("SELECT status, resolved_at FROM issues WHERE id = ?")
      .bind(id)
      .first<{ status: string; resolved_at: string | null }>();
    expect(row?.status).toBe("resolved");
    expect(row?.resolved_at).not.toBeNull();
  });

  it("preserves resolved_at on subsequent reopen (history kept)", async () => {
    const id = await makeIssue();
    await setIssueStatus(getDb(), id, "resolved", "user:abc");
    const before = await getDb()
      .prepare("SELECT resolved_at FROM issues WHERE id = ?")
      .bind(id)
      .first<{ resolved_at: string | null }>();

    await setIssueStatus(getDb(), id, "open", "user:abc", "false alarm");
    const after = await getDb()
      .prepare("SELECT status, resolved_at FROM issues WHERE id = ?")
      .bind(id)
      .first<{ status: string; resolved_at: string | null }>();

    expect(after?.status).toBe("open");
    expect(after?.resolved_at).toBe(before?.resolved_at);
  });

  it("returns null for an unknown issue id", async () => {
    await freshDb();
    await ensureDefaultProperty(getDb());
    const r = await setIssueStatus(getDb(), "default:nope", "resolved", "user:abc");
    expect(r).toBeNull();
  });

  it("records the reason when supplied", async () => {
    const id = await makeIssue();
    await setIssueStatus(getDb(), id, "ignored", "user:abc", "vendor extension noise");
    const log = await getDb()
      .prepare("SELECT reason FROM issue_status_log WHERE issue_id = ?")
      .bind(id)
      .first<{ reason: string }>();
    expect(log?.reason).toBe("vendor extension noise");
  });
});
