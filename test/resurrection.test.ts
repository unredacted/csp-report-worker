/**
 * Tests for issue resurrection — auto-reopen of resolved issues after the
 * grace window, and the transition return value used by the notify gate.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { runMigrations, _resetMigrationCache } from "../src/db";
import { ensureDefaultProperty } from "../src/properties";
import { computeFingerprint } from "../src/dedup";
import { setIssueStatus, upsertIssue } from "../src/issues";
import type { Env, NormalisedReport, Property } from "../src/types";

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

async function setup(): Promise<{ property: Property; report: NormalisedReport; fp: string }> {
  await freshDb();
  const property = await ensureDefaultProperty(getDb());
  const report = makeReport();
  const fp = await computeFingerprint(report);
  return { property, report, fp };
}

describe("upsertIssue transition gate", () => {
  beforeEach(freshDb);

  it("returns `created` on first occurrence", async () => {
    const { property, report, fp } = await setup();
    const r = await upsertIssue(getDb(), property, report, fp);
    expect(r.transition).toBe("created");
    expect(r.created).toBe(true);
    expect(r.status).toBe("open");
  });

  it("returns `noop` on subsequent open occurrences", async () => {
    const { property, report, fp } = await setup();
    await upsertIssue(getDb(), property, report, fp);
    const second = await upsertIssue(getDb(), property, report, fp);
    expect(second.transition).toBe("noop");
    expect(second.created).toBe(false);
    expect(second.eventCount).toBe(2);
    expect(second.status).toBe("open");
  });

  it("returns `noop` on reports for `acknowledged` issues", async () => {
    const { property, report, fp } = await setup();
    const first = await upsertIssue(getDb(), property, report, fp);
    await setIssueStatus(getDb(), first.issueId, "acknowledged", "user:test");
    const second = await upsertIssue(getDb(), property, report, fp);
    expect(second.transition).toBe("noop");
    expect(second.status).toBe("acknowledged");
  });

  it("returns `noop` on reports for `ignored` issues — count still increments", async () => {
    const { property, report, fp } = await setup();
    const first = await upsertIssue(getDb(), property, report, fp);
    await setIssueStatus(getDb(), first.issueId, "ignored", "user:test");
    const second = await upsertIssue(getDb(), property, report, fp);
    const third = await upsertIssue(getDb(), property, report, fp);
    expect(second.transition).toBe("noop");
    expect(third.transition).toBe("noop");
    expect(third.eventCount).toBe(3);
    expect(third.status).toBe("ignored");
  });
});

describe("upsertIssue resurrection within grace", () => {
  beforeEach(freshDb);

  it("does not resurrect within the grace window", async () => {
    const { property, report, fp } = await setup();
    const first = await upsertIssue(getDb(), property, report, fp);
    await setIssueStatus(getDb(), first.issueId, "resolved", "user:test");

    // Grace = 1 hour; resolved_at is now, so within grace.
    const oneHourMs = 60 * 60 * 1000;
    const second = await upsertIssue(getDb(), property, report, fp, oneHourMs);
    expect(second.transition).toBe("noop");
    expect(second.status).toBe("resolved");
  });

  it("resurrects past the grace window", async () => {
    const { property, report, fp } = await setup();
    const first = await upsertIssue(getDb(), property, report, fp);
    await setIssueStatus(getDb(), first.issueId, "resolved", "user:test");

    // Force resolved_at into the deep past so any grace passes.
    await getDb()
      .prepare("UPDATE issues SET resolved_at = ? WHERE id = ?")
      .bind("2020-01-01T00:00:00.000Z", first.issueId)
      .run();

    const second = await upsertIssue(getDb(), property, report, fp, 60 * 60 * 1000);
    expect(second.transition).toBe("resurrected");
    expect(second.resurrected).toBe(true);
    expect(second.status).toBe("open");
  });

  it("logs the auto-reopen in issue_status_log with actor=system:resurrection", async () => {
    const { property, report, fp } = await setup();
    const first = await upsertIssue(getDb(), property, report, fp);
    await setIssueStatus(getDb(), first.issueId, "resolved", "user:test");
    await getDb()
      .prepare("UPDATE issues SET resolved_at = ? WHERE id = ?")
      .bind("2020-01-01T00:00:00.000Z", first.issueId)
      .run();
    await upsertIssue(getDb(), property, report, fp, 60 * 60 * 1000);

    const log = await getDb()
      .prepare(
        "SELECT actor, from_status, to_status FROM issue_status_log WHERE issue_id = ? ORDER BY id DESC LIMIT 1",
      )
      .bind(first.issueId)
      .first<{ actor: string; from_status: string; to_status: string }>();
    expect(log?.actor).toBe("system:resurrection");
    expect(log?.from_status).toBe("resolved");
    expect(log?.to_status).toBe("open");
  });
});
