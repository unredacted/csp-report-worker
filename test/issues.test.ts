/**
 * Tests for the issue grouping write + read pipelines.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { runMigrations, _resetMigrationCache } from "../src/db";
import { ensureDefaultProperty } from "../src/properties";
import { computeFingerprint } from "../src/dedup";
import {
  upsertIssue,
  insertEvent,
  listIssues,
  getIssue,
  issueIdFor,
} from "../src/issues";
import type { Env, NormalisedReport, Property } from "../src/types";
import type { RequestContext } from "../src/cf";

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
    userAgent: "Mozilla/5.0 Chrome/120",
    sourceFormat: "report-uri",
    category: "external",
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<RequestContext>): RequestContext {
  return {
    country: "DE",
    asn: 15169,
    asOrg: "Google LLC",
    colo: "FRA",
    cfRay: "8a1b2c3d-FRA",
    httpProtocol: "HTTP/3",
    ...overrides,
  };
}

async function withProperty(): Promise<Property> {
  await freshDb();
  return ensureDefaultProperty(getDb());
}

describe("upsertIssue", () => {
  it("creates a new issue on first occurrence", async () => {
    const property = await withProperty();
    const report = makeReport();
    const fp = await computeFingerprint(report);
    const result = await upsertIssue(getDb(), property, report, fp);

    expect(result.created).toBe(true);
    expect(result.prevStatus).toBeNull();
    expect(result.eventCount).toBe(1);
    expect(result.issueId).toBe(issueIdFor(property.id, fp));
  });

  it("bumps event_count on repeat occurrence", async () => {
    const property = await withProperty();
    const report = makeReport();
    const fp = await computeFingerprint(report);
    await upsertIssue(getDb(), property, report, fp);
    const second = await upsertIssue(getDb(), property, report, fp);
    const third = await upsertIssue(getDb(), property, report, fp);

    expect(second.created).toBe(false);
    expect(second.eventCount).toBe(2);
    expect(second.prevStatus).toBe("open");
    expect(third.eventCount).toBe(3);
  });

  it("issue id includes the property id", async () => {
    const property = await withProperty();
    const report = makeReport();
    const fp = await computeFingerprint(report);
    const result = await upsertIssue(getDb(), property, report, fp);
    expect(result.issueId.startsWith(`${property.id}:`)).toBe(true);
  });
});

describe("insertEvent + cap", () => {
  it("trims to the configured cap", async () => {
    const property = await withProperty();
    const report = makeReport();
    const fp = await computeFingerprint(report);
    const { issueId } = await upsertIssue(getDb(), property, report, fp);

    const cap = 5;
    for (let i = 0; i < 12; i++) {
      await insertEvent(
        getDb(),
        issueId,
        { ...report, timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString() },
        makeCtx(),
        cap,
      );
    }

    const count = await getDb()
      .prepare("SELECT COUNT(*) AS n FROM issue_events WHERE issue_id = ?")
      .bind(issueId)
      .first<{ n: number }>();
    expect(count?.n).toBe(cap);
  });

  it("never persists an IP-shaped column even if event has CF context", async () => {
    const property = await withProperty();
    const report = makeReport();
    const fp = await computeFingerprint(report);
    const { issueId } = await upsertIssue(getDb(), property, report, fp);
    await insertEvent(getDb(), issueId, report, makeCtx(), 100);

    const cols = await getDb().prepare("PRAGMA table_info(issue_events)").all<{
      name: string;
    }>();
    const names = (cols.results ?? []).map((c) => c.name);
    expect(names).not.toContain("ip");
  });
});

describe("listIssues", () => {
  it("returns issues newest-first", async () => {
    const property = await withProperty();
    const r1 = makeReport({ blockedUri: "https://a.com/1.js" });
    const r2 = makeReport({ blockedUri: "https://b.com/2.js" });
    const fp1 = await computeFingerprint(r1);
    const fp2 = await computeFingerprint(r2);
    await upsertIssue(getDb(), property, r1, fp1);
    // Manually backdate the first one so the order is deterministic.
    await getDb()
      .prepare("UPDATE issues SET last_seen = ? WHERE id = ?")
      .bind("2025-01-01T00:00:00.000Z", `${property.id}:${fp1}`)
      .run();
    await upsertIssue(getDb(), property, r2, fp2);

    const result = await listIssues(getDb());
    expect(result.issues.length).toBe(2);
    expect(result.issues[0]!.fingerprint).toBe(fp2);
    expect(result.issues[1]!.fingerprint).toBe(fp1);
  });

  it("filters by status", async () => {
    const property = await withProperty();
    const r1 = makeReport({ blockedUri: "https://a.com/1.js" });
    const r2 = makeReport({ blockedUri: "https://b.com/2.js" });
    const fp1 = await computeFingerprint(r1);
    const fp2 = await computeFingerprint(r2);
    await upsertIssue(getDb(), property, r1, fp1);
    await upsertIssue(getDb(), property, r2, fp2);
    await getDb()
      .prepare("UPDATE issues SET status = 'resolved' WHERE id = ?")
      .bind(`${property.id}:${fp1}`)
      .run();

    const open = await listIssues(getDb(), { statuses: ["open"] });
    expect(open.issues.map((i) => i.fingerprint)).toEqual([fp2]);

    const resolved = await listIssues(getDb(), { statuses: ["resolved"] });
    expect(resolved.issues.map((i) => i.fingerprint)).toEqual([fp1]);
  });

  it("filters by directive", async () => {
    const property = await withProperty();
    const r1 = makeReport({ violatedDirective: "script-src", blockedUri: "https://a.com/1.js" });
    const r2 = makeReport({ violatedDirective: "img-src", blockedUri: "https://b.com/2.png" });
    const fp1 = await computeFingerprint(r1);
    const fp2 = await computeFingerprint(r2);
    await upsertIssue(getDb(), property, r1, fp1);
    await upsertIssue(getDb(), property, r2, fp2);

    const result = await listIssues(getDb(), { directive: "img-src" });
    expect(result.issues.map((i) => i.fingerprint)).toEqual([fp2]);
  });

  it("paginates via cursor", async () => {
    const property = await withProperty();
    for (let i = 0; i < 5; i++) {
      const r = makeReport({ blockedUri: `https://a.com/${i}.js` });
      const fp = await computeFingerprint(r);
      await upsertIssue(getDb(), property, r, fp);
    }

    const page1 = await listIssues(getDb(), { limit: 2 });
    expect(page1.issues.length).toBe(2);
    expect(page1.cursor).not.toBeNull();

    const page2 = await listIssues(getDb(), { limit: 2, cursor: page1.cursor! });
    expect(page2.issues.length).toBe(2);
    expect(page2.cursor).not.toBeNull();
    // Distinct ids
    const ids = new Set([...page1.issues, ...page2.issues].map((i) => i.id));
    expect(ids.size).toBe(4);

    const page3 = await listIssues(getDb(), { limit: 2, cursor: page2.cursor! });
    expect(page3.issues.length).toBe(1);
    expect(page3.cursor).toBeNull();
  });
});

describe("getIssue", () => {
  it("returns null for unknown id", async () => {
    await withProperty();
    const detail = await getIssue(getDb(), "default:nonexistent");
    expect(detail).toBeNull();
  });

  it("returns the issue + last events + aggregates", async () => {
    const property = await withProperty();
    const report = makeReport();
    const fp = await computeFingerprint(report);
    const { issueId } = await upsertIssue(getDb(), property, report, fp);

    await insertEvent(getDb(), issueId, report, makeCtx({ country: "DE", asn: 1 }), 100);
    await insertEvent(getDb(), issueId, report, makeCtx({ country: "DE", asn: 1 }), 100);
    await insertEvent(getDb(), issueId, report, makeCtx({ country: "FR", asn: 2 }), 100);
    await insertEvent(
      getDb(),
      issueId,
      { ...report, userAgent: "Mozilla/5.0 Firefox/127" },
      makeCtx({ country: "FR", asn: 2 }),
      100,
    );

    const detail = await getIssue(getDb(), issueId);
    expect(detail).not.toBeNull();
    expect(detail!.issue.id).toBe(issueId);
    expect(detail!.events.length).toBe(4);

    expect(detail!.aggregates.countries.length).toBeGreaterThan(0);
    const de = detail!.aggregates.countries.find((b) => b.label === "DE");
    expect(de?.count).toBe(2);

    expect(detail!.aggregates.browsers.length).toBeGreaterThan(0);
    const chrome = detail!.aggregates.browsers.find((b) => b.label === "Chrome");
    const firefox = detail!.aggregates.browsers.find((b) => b.label === "Firefox");
    expect(chrome?.count).toBe(3);
    expect(firefox?.count).toBe(1);
  });
});
