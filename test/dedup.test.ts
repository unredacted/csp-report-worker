/**
 * Tests for the dedup fingerprint.
 *
 * (The KV-window dedup logic was removed in M3 — D1 issue rows are now
 * the dedup truth and notifications gate on issue status transitions.
 * See test/resurrection.test.ts for the new gate behaviour.)
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { computeFingerprint } from "../src/dedup";
import type { NormalisedReport } from "../src/types";

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

describe("computeFingerprint", () => {
  it("should produce a 64-character hex SHA-256 hash", async () => {
    const report = makeReport();
    const fp = await computeFingerprint(report);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should produce the same fingerprint for identical violation fields", async () => {
    const r1 = makeReport();
    const r2 = makeReport({ id: "different-id", timestamp: "2026-02-01T00:00:00.000Z" });
    const fp1 = await computeFingerprint(r1);
    const fp2 = await computeFingerprint(r2);
    expect(fp1).toBe(fp2);
  });

  it("should produce different fingerprints for different blockedUri", async () => {
    const r1 = makeReport();
    const r2 = makeReport({ blockedUri: "https://other.com/bad.js" });
    const fp1 = await computeFingerprint(r1);
    const fp2 = await computeFingerprint(r2);
    expect(fp1).not.toBe(fp2);
  });

  it("should produce different fingerprints for different documentUri", async () => {
    const r1 = makeReport();
    const r2 = makeReport({ documentUri: "https://example.com/other-page" });
    const fp1 = await computeFingerprint(r1);
    const fp2 = await computeFingerprint(r2);
    expect(fp1).not.toBe(fp2);
  });

  it("should produce different fingerprints for different violatedDirective", async () => {
    const r1 = makeReport();
    const r2 = makeReport({ violatedDirective: "style-src" });
    const fp1 = await computeFingerprint(r1);
    const fp2 = await computeFingerprint(r2);
    expect(fp1).not.toBe(fp2);
  });

  it("should produce different fingerprints for different line numbers", async () => {
    const r1 = makeReport();
    const r2 = makeReport({ lineNumber: 99 });
    const fp1 = await computeFingerprint(r1);
    const fp2 = await computeFingerprint(r2);
    expect(fp1).not.toBe(fp2);
  });
});

