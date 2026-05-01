/**
 * Tests for API endpoints (GET /reports, GET /reports/:id, GET /health).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { storeReport } from "../src/store";
import { getKvNamespace } from "../src/config";
import type { Env, NormalisedReport } from "../src/types";

// We test by calling the worker's fetch handler directly
import worker from "../src/index";

const API_TOKEN = "test-secret-token";

function makeReport(overrides?: Partial<NormalisedReport>): NormalisedReport {
  return {
    id: "abc123def456" + Math.random().toString(36).slice(2, 8),
    timestamp: new Date().toISOString(),
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

/**
 * Create a mock ExecutionContext that collects waitUntil promises
 * so they can be awaited before the test ends (required by
 * cloudflare vitest-pool-workers isolated storage).
 */
function mockCtx(): ExecutionContext & { flush(): Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
    passThroughOnException() {},
    props: {},
    /** Await all background work enqueued via waitUntil. */
    async flush() {
      await Promise.allSettled(pending);
    },
  } as unknown as ExecutionContext & { flush(): Promise<void> };
}

// Build an env for tests with API_TOKEN injected
function testEnv(): Env {
  return { ...env, API_TOKEN } as Env;
}

describe("GET /health", () => {
  it("should return 204", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/health");
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(204);
  });
});

describe("GET /auth/check", () => {
  it("returns 204 with a valid Bearer token", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/auth/check", {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(204);
  });

  it("returns 401 with no Authorization header", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/auth/check");
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(401);
  });

  it("returns 403 with an invalid token", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/auth/check", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(403);
  });
});

describe("GET /reports", () => {
  it("should return 401 without auth header", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/reports");
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(401);
  });

  it("should return 403 with invalid token", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/reports", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(403);
  });

  it("should return 200 with valid token", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/reports", {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { reports: NormalisedReport[]; cursor: string | null };
    expect(body.reports).toBeInstanceOf(Array);
    expect(body).toHaveProperty("cursor");
  });

  it("should return stored reports", async () => {
    const ctx = mockCtx();
    const report = makeReport();
    await storeReport(getKvNamespace(env as unknown as Env), report, 600);

    const req = new Request("https://worker.example.com/reports", {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { reports: NormalisedReport[] };
    const found = body.reports.find((r) => r.id === report.id);
    expect(found).toBeDefined();
    expect(found!.documentUri).toBe("https://example.com/page");
  });
});

describe("GET /reports?category=", () => {
  it("returns 400 for an unknown category", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/reports?category=garbage", {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(400);
  });

  it("filters listings by category", async () => {
    const ctx = mockCtx();
    const ext = makeReport({
      id: "ee" + Date.now().toString(16) + "ext",
      blockedUri: "chrome-extension://abc/x.js",
      category: "extension",
    });
    const real = makeReport({
      id: "ee" + Date.now().toString(16) + "real",
      blockedUri: "https://evil.example/x.js",
      category: "external",
    });
    await storeReport(getKvNamespace(env as unknown as Env), ext, 600);
    await storeReport(getKvNamespace(env as unknown as Env), real, 600);

    const req = new Request(
      "https://worker.example.com/reports?category=extension&limit=200",
      { headers: { Authorization: `Bearer ${API_TOKEN}` } },
    );
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { reports: NormalisedReport[] };
    const ids = body.reports.map((r) => r.id);
    expect(ids).toContain(ext.id);
    expect(ids).not.toContain(real.id);
    // All returned reports should be in the requested category
    for (const r of body.reports) expect(r.category).toBe("extension");
  });
});

describe("backfill of pre-migration records", () => {
  it("derives category from blockedUri when reading an old record without one", async () => {
    const ctx = mockCtx();
    // Simulate a record written by the old Worker: no category field, empty
    // violatedDirective. Cast through unknown so TS lets us omit `category`.
    const oldRecord = {
      id: "ee" + Date.now().toString(16) + "0d0001",
      timestamp: new Date().toISOString(),
      documentUri: "https://example.com/page",
      blockedUri: "https://evil.example/x.js",
      violatedDirective: "",
      effectiveDirective: "script-src",
      originalPolicy: "script-src 'self'",
      disposition: "enforce",
      referrer: "",
      sourceFile: "",
      lineNumber: 0,
      columnNumber: 0,
      statusCode: 200,
      userAgent: "",
      sourceFormat: "report-to",
    } as unknown as NormalisedReport;
    await storeReport(getKvNamespace(env as unknown as Env), oldRecord, 600);

    const req = new Request(`https://worker.example.com/reports/${oldRecord.id}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(200);

    const body = (await res.json()) as NormalisedReport;
    // Backfilled at read time from the URLs.
    expect(body.category).toBe("external");
    // violatedDirective backfilled from effectiveDirective.
    expect(body.violatedDirective).toBe("script-src");
  });

  it("backfilled category lets ?category= filter find old records", async () => {
    const ctx = mockCtx();
    const oldExt = {
      id: "ee" + Date.now().toString(16) + "0dec71",
      timestamp: new Date().toISOString(),
      documentUri: "https://example.com/page",
      blockedUri: "chrome-extension://abc/inject.js",
      violatedDirective: "",
      effectiveDirective: "script-src",
      originalPolicy: "",
      disposition: "enforce",
      referrer: "",
      sourceFile: "",
      lineNumber: 0,
      columnNumber: 0,
      statusCode: 200,
      userAgent: "",
      sourceFormat: "report-to",
    } as unknown as NormalisedReport;
    await storeReport(getKvNamespace(env as unknown as Env), oldExt, 600);

    const req = new Request(
      "https://worker.example.com/reports?category=extension&limit=200",
      { headers: { Authorization: `Bearer ${API_TOKEN}` } },
    );
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    const body = (await res.json()) as { reports: NormalisedReport[] };
    expect(body.reports.map((r) => r.id)).toContain(oldExt.id);
  });
});

describe("GET /reports/:id", () => {
  it("should return 404 for nonexistent report", async () => {
    const ctx = mockCtx();
    // Use a hex-only ID so the route regex matches and the handler runs.
    // Non-hex IDs would 404 by routing miss, not by report-not-found.
    const req = new Request(
      "https://worker.example.com/reports/deadbeefcafef00ddeadbeefcafef00d",
      { headers: { Authorization: `Bearer ${API_TOKEN}` } },
    );
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(404);
  });

  it("should return a stored report by ID", async () => {
    const ctx = mockCtx();
    const report = makeReport({ id: "aabbccddee" + Date.now().toString(16) });
    await storeReport(getKvNamespace(env as unknown as Env), report, 600);

    const req = new Request(`https://worker.example.com/reports/${report.id}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(200);

    const body = (await res.json()) as NormalisedReport;
    expect(body.id).toBe(report.id);
    expect(body.blockedUri).toBe("https://evil.com/script.js");
  });
});

describe("POST /report", () => {
  it("should return 204 for a valid legacy report", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/report", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: JSON.stringify({
        "csp-report": {
          "document-uri": "https://example.com/",
          "blocked-uri": "https://cdn.example.com/lib.js",
          "violated-directive": "script-src",
        },
      }),
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    // Must await background KV writes before test ends
    await ctx.flush();
    expect(res.status).toBe(204);
  });

  it("should return 400 for empty body", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/report", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: "",
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(400);
  });

  it("should handle CORS preflight", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/report", {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  it("returns 204 and STORES extension-noise reports for forensic review", async () => {
    const kv = getKvNamespace(env as unknown as Env);
    const before = await kv.list({ prefix: "report:" });
    const beforeCount = before.keys.length;

    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/report", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: JSON.stringify({
        "csp-report": {
          "document-uri": "https://example.com/",
          "blocked-uri": "chrome-extension://abcdef/inject.js",
          "violated-directive": "script-src",
        },
      }),
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(204);

    // The report is now stored even though notifications are muted.
    const after = await kv.list({ prefix: "report:" });
    expect(after.keys.length).toBe(beforeCount + 1);
  });

  it("stores every entry of a Reporting API array including muted ones", async () => {
    const kv = getKvNamespace(env as unknown as Env);
    const before = await kv.list({ prefix: "report:" });
    const beforeCount = before.keys.length;

    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/report", {
      method: "POST",
      headers: { "Content-Type": "application/reports+json" },
      body: JSON.stringify([
        {
          type: "csp-violation",
          age: 0,
          url: "https://example.com/",
          user_agent: "Mozilla/5.0",
          body: {
            documentURL: "https://example.com/",
            blockedURL: "moz-extension://abc/x.js",
            effectiveDirective: "script-src",
          },
        },
        {
          type: "csp-violation",
          age: 0,
          url: "https://example.com/",
          user_agent: "Mozilla/5.0",
          body: {
            documentURL: "https://example.com/",
            blockedURL: "chrome-extension://def/y.js",
            effectiveDirective: "script-src",
          },
        },
      ]),
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(204);

    const after = await kv.list({ prefix: "report:" });
    expect(after.keys.length).toBe(beforeCount + 2);
  });
});

describe("unmatched route handling", () => {
  it("returns 404 for unknown non-GET methods", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/unknown", { method: "PUT" });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(404);
  });

  it("falls back to the dashboard SPA on unknown GET when ASSETS is bound", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/list");
    // Test env may or may not have ASSETS depending on the wrangler.toml in
    // use; in CI the [assets] block is present and asset fallback returns
    // 200 with the SPA shell, in local minimal configs ASSETS is absent and
    // the JSON 404 path is exercised. Either is correct.
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect([200, 404]).toContain(res.status);
  });
});
