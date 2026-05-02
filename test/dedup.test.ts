/**
 * Tests for deduplication fingerprint and window logic.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { computeFingerprint, isDuplicate, recordDedup } from "../src/dedup";
import { getKvNamespace } from "../src/config";
import type { Env, NormalisedReport } from "../src/types";

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

describe("isDuplicate + recordDedup", () => {
  it("should return false for unseen fingerprint", async () => {
    const fp = "test-fingerprint-" + Date.now();
    const result = await isDuplicate(getKvNamespace(env as unknown as Env), fp);
    expect(result).toBe(false);
  });

  it("should return true after recording a fingerprint", async () => {
    const fp = "test-recorded-" + Date.now();
    await recordDedup(getKvNamespace(env as unknown as Env), fp, 60);
    const result = await isDuplicate(getKvNamespace(env as unknown as Env), fp);
    expect(result).toBe(true);
  });

  it("should increment count on repeated records", async () => {
    const fp = "test-counting-" + Date.now();
    await recordDedup(getKvNamespace(env as unknown as Env), fp, 60);
    await recordDedup(getKvNamespace(env as unknown as Env), fp, 60);
    await recordDedup(getKvNamespace(env as unknown as Env), fp, 60);

    const raw = await (getKvNamespace(env as unknown as Env)).get(`dedup:${fp}`, "json") as { count: number } | null;
    expect(raw).not.toBeNull();
    expect(raw!.count).toBe(3);
  });
});
