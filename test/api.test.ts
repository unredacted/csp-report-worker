/**
 * Tests for API endpoints (GET /reports, GET /reports/:id, GET /health).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { storeReport } from "../src/store";
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
    await storeReport(env.CSP_REPORTS as KVNamespace, report, 600);

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

describe("GET /reports/:id", () => {
  it("should return 404 for nonexistent report", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/reports/nonexistent123abc", {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(404);
  });

  it("should return a stored report by ID", async () => {
    const ctx = mockCtx();
    const report = makeReport({ id: "aabbccddee" + Date.now().toString(16) });
    await storeReport(env.CSP_REPORTS as KVNamespace, report, 600);

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
});

describe("404 fallback", () => {
  it("should return 404 for unknown paths", async () => {
    const ctx = mockCtx();
    const req = new Request("https://worker.example.com/unknown");
    const res = await worker.fetch(req, testEnv(), ctx);
    await ctx.flush();
    expect(res.status).toBe(404);
  });
});
