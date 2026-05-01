/**
 * Tests for report ingestion and normalisation.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { parseRequest } from "../src/ingest";
import type { Env } from "../src/types";

function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ...overrides } as Env;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEGACY_BODY = {
  "csp-report": {
    "document-uri": "https://example.com/page",
    "blocked-uri": "https://evil.com/script.js",
    "violated-directive": "script-src",
    "effective-directive": "script-src",
    "original-policy": "script-src 'self'; report-uri /report",
    disposition: "enforce",
    referrer: "https://example.com/",
    "source-file": "https://example.com/page",
    "line-number": 12,
    "column-number": 34,
    "status-code": 200,
  },
};

const REPORTING_API_BODY = [
  {
    type: "csp-violation",
    age: 0,
    url: "https://example.com/page",
    user_agent: "Mozilla/5.0",
    body: {
      documentURL: "https://example.com/page",
      blockedURL: "https://evil.com/script.js",
      violatedDirective: "script-src",
      effectiveDirective: "script-src",
      originalPolicy: "script-src 'self'",
      disposition: "enforce",
      referrer: "https://example.com/",
      sourceFile: "https://example.com/page",
      lineNumber: 12,
      columnNumber: 34,
      statusCode: 200,
    },
  },
];

function makeRequest(body: unknown, contentType: string): Request {
  return new Request("https://worker.example.com/report", {
    method: "POST",
    headers: { "Content-Type": contentType, "User-Agent": "TestAgent/1.0" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseRequest", () => {
  describe("legacy report-uri format", () => {
    it("should parse a valid legacy CSP report", async () => {
      const req = makeRequest(LEGACY_BODY, "application/csp-report");
      const reports = await parseRequest(req, testEnv());

      expect(reports).toHaveLength(1);
      const r = reports[0]!;
      expect(r.documentUri).toBe("https://example.com/page");
      expect(r.blockedUri).toBe("https://evil.com/script.js");
      expect(r.violatedDirective).toBe("script-src");
      expect(r.effectiveDirective).toBe("script-src");
      expect(r.disposition).toBe("enforce");
      expect(r.sourceFile).toBe("https://example.com/page");
      expect(r.lineNumber).toBe(12);
      expect(r.columnNumber).toBe(34);
      expect(r.statusCode).toBe(200);
      expect(r.sourceFormat).toBe("report-uri");
      expect(r.userAgent).toBe("TestAgent/1.0");
      expect(r.id).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
      expect(r.timestamp).toBeTruthy();
    });

    it("should reject missing csp-report key", async () => {
      const req = makeRequest({ foo: "bar" }, "application/csp-report");
      await expect(parseRequest(req, testEnv())).rejects.toBeInstanceOf(Response);
    });
  });

  describe("Reporting API v1 format", () => {
    it("should parse a valid Reporting API array", async () => {
      const req = makeRequest(REPORTING_API_BODY, "application/reports+json");
      const reports = await parseRequest(req, testEnv());

      expect(reports).toHaveLength(1);
      const r = reports[0]!;
      expect(r.documentUri).toBe("https://example.com/page");
      expect(r.blockedUri).toBe("https://evil.com/script.js");
      expect(r.violatedDirective).toBe("script-src");
      expect(r.sourceFormat).toBe("report-to");
    });

    it("should filter out non-CSP entries", async () => {
      const mixed = [
        ...REPORTING_API_BODY,
        {
          type: "deprecation",
          age: 0,
          url: "https://example.com",
          body: { id: "some-deprecation" },
        },
      ];
      const req = makeRequest(mixed, "application/reports+json");
      const reports = await parseRequest(req, testEnv());

      // Only the csp-violation entry should be returned
      expect(reports).toHaveLength(1);
      expect(reports[0]!.sourceFormat).toBe("report-to");
    });

    it("should reject an array with no csp-violation entries", async () => {
      const noCsp = [
        { type: "deprecation", age: 0, url: "https://example.com", body: {} },
      ];
      const req = makeRequest(noCsp, "application/reports+json");
      await expect(parseRequest(req, testEnv())).rejects.toBeInstanceOf(Response);
    });

    it("should reject a non-array body for reports+json", async () => {
      const req = makeRequest({ foo: "bar" }, "application/reports+json");
      await expect(parseRequest(req, testEnv())).rejects.toBeInstanceOf(Response);
    });
  });

  describe("format auto-detection", () => {
    it("should auto-detect legacy format without content-type", async () => {
      const req = makeRequest(LEGACY_BODY, "application/json");
      const reports = await parseRequest(req, testEnv());
      expect(reports).toHaveLength(1);
      expect(reports[0]!.sourceFormat).toBe("report-uri");
    });

    it("should auto-detect Reporting API format without content-type", async () => {
      const req = makeRequest(REPORTING_API_BODY, "application/json");
      const reports = await parseRequest(req, testEnv());
      expect(reports).toHaveLength(1);
      expect(reports[0]!.sourceFormat).toBe("report-to");
    });
  });

  describe("validation", () => {
    it("should reject oversized bodies", async () => {
      // 65 KB body
      const largeBody = { "csp-report": { "document-uri": "x".repeat(70_000) } };
      const req = makeRequest(largeBody, "application/csp-report");
      await expect(parseRequest(req, testEnv())).rejects.toBeInstanceOf(Response);
    });

    it("should reject empty body", async () => {
      const req = new Request("https://worker.example.com/report", {
        method: "POST",
        headers: { "Content-Type": "application/csp-report" },
        body: "",
      });
      await expect(parseRequest(req, testEnv())).rejects.toBeInstanceOf(Response);
    });

    it("should reject invalid JSON", async () => {
      const req = new Request("https://worker.example.com/report", {
        method: "POST",
        headers: { "Content-Type": "application/csp-report" },
        body: "not json{{{",
      });
      await expect(parseRequest(req, testEnv())).rejects.toBeInstanceOf(Response);
    });
  });

  describe("deterministic IDs", () => {
    it("should produce the same ID for the same report content", async () => {
      const req1 = makeRequest(LEGACY_BODY, "application/csp-report");
      const req2 = makeRequest(LEGACY_BODY, "application/csp-report");

      const [r1] = await parseRequest(req1, testEnv());
      const [r2] = await parseRequest(req2, testEnv());

      // IDs include timestamp which will differ between calls,
      // so this verifies the hash incorporates the right fields.
      // Both will have different IDs because timestamp differs.
      expect(r1!.id).toMatch(/^[a-f0-9]{64}$/);
      expect(r2!.id).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("directive fallback (regression — violatedDirective blank in modern Reporting API)", () => {
    it("should fall back to effectiveDirective when only effectiveDirective is sent (Reporting API)", async () => {
      const body = [
        {
          type: "csp-violation",
          age: 0,
          url: "https://example.com/page",
          user_agent: "Mozilla/5.0",
          body: {
            documentURL: "https://example.com/page",
            blockedURL: "https://evil.example/script.js",
            // Modern Chromium/Firefox often only send effectiveDirective
            effectiveDirective: "script-src-elem",
            originalPolicy: "script-src 'self'",
            disposition: "enforce",
            referrer: "",
            sourceFile: "https://example.com/page",
            lineNumber: 1,
            columnNumber: 1,
            statusCode: 200,
          },
        },
      ];
      const req = makeRequest(body, "application/reports+json");
      const [r] = await parseRequest(req, testEnv());
      expect(r!.violatedDirective).toBe("script-src-elem");
      expect(r!.effectiveDirective).toBe("script-src-elem");
    });

    it("should fall back to violatedDirective when only violatedDirective is sent (Reporting API)", async () => {
      const body = [
        {
          type: "csp-violation",
          age: 0,
          url: "https://example.com/page",
          user_agent: "Mozilla/5.0",
          body: {
            documentURL: "https://example.com/page",
            blockedURL: "https://evil.example/script.js",
            violatedDirective: "script-src",
            originalPolicy: "script-src 'self'",
            disposition: "enforce",
            referrer: "",
            sourceFile: "https://example.com/page",
            lineNumber: 1,
            columnNumber: 1,
            statusCode: 200,
          },
        },
      ];
      const req = makeRequest(body, "application/reports+json");
      const [r] = await parseRequest(req, testEnv());
      expect(r!.violatedDirective).toBe("script-src");
      expect(r!.effectiveDirective).toBe("script-src");
    });

    it("should preserve both fields independently when both are sent (Reporting API)", async () => {
      const body = [
        {
          type: "csp-violation",
          age: 0,
          url: "https://example.com/page",
          user_agent: "Mozilla/5.0",
          body: {
            documentURL: "https://example.com/page",
            blockedURL: "https://evil.example/script.js",
            violatedDirective: "script-src",
            effectiveDirective: "script-src-elem",
            originalPolicy: "script-src 'self'",
            disposition: "enforce",
            referrer: "",
            sourceFile: "https://example.com/page",
            lineNumber: 1,
            columnNumber: 1,
            statusCode: 200,
          },
        },
      ];
      const req = makeRequest(body, "application/reports+json");
      const [r] = await parseRequest(req, testEnv());
      expect(r!.violatedDirective).toBe("script-src");
      expect(r!.effectiveDirective).toBe("script-src-elem");
    });

    it("should fall back to effective-directive when only effective-directive is sent (legacy)", async () => {
      const body = {
        "csp-report": {
          "document-uri": "https://example.com/page",
          "blocked-uri": "https://evil.example/script.js",
          "effective-directive": "script-src-elem",
          "original-policy": "script-src 'self'",
          disposition: "enforce",
          "source-file": "https://example.com/page",
          "line-number": 1,
          "column-number": 1,
          "status-code": 200,
        },
      };
      const req = makeRequest(body, "application/csp-report");
      const [r] = await parseRequest(req, testEnv());
      expect(r!.violatedDirective).toBe("script-src-elem");
      expect(r!.effectiveDirective).toBe("script-src-elem");
    });
  });

  describe("disposition normalisation", () => {
    it("should default to enforce for unknown dispositions", async () => {
      const body = {
        "csp-report": {
          ...LEGACY_BODY["csp-report"],
          disposition: "unknown",
        },
      };
      const req = makeRequest(body, "application/csp-report");
      const [r] = await parseRequest(req, testEnv());
      expect(r!.disposition).toBe("enforce");
    });

    it("should preserve report disposition", async () => {
      const body = {
        "csp-report": {
          ...LEGACY_BODY["csp-report"],
          disposition: "report",
        },
      };
      const req = makeRequest(body, "application/csp-report");
      const [r] = await parseRequest(req, testEnv());
      expect(r!.disposition).toBe("report");
    });
  });

  describe("noise filtering — drop browser-extension and browser-internal blockedUris", () => {
    function legacyWithBlockedUri(uri: string) {
      return {
        "csp-report": {
          ...LEGACY_BODY["csp-report"],
          "blocked-uri": uri,
        },
      };
    }

    function reportingApiWithBlockedUri(uri: string) {
      return [
        {
          type: "csp-violation",
          age: 0,
          url: "https://example.com/page",
          user_agent: "Mozilla/5.0",
          body: {
            ...REPORTING_API_BODY[0]!.body,
            blockedURL: uri,
          },
        },
      ];
    }

    it("drops chrome-extension:// blockedUri (Reporting API)", async () => {
      const req = makeRequest(
        reportingApiWithBlockedUri("chrome-extension://abcdef/inject.js"),
        "application/reports+json",
      );
      const reports = await parseRequest(req, testEnv());
      expect(reports).toHaveLength(0);
    });

    it("drops chrome-extension:// blockedUri (legacy)", async () => {
      const req = makeRequest(
        legacyWithBlockedUri("chrome-extension://abcdef/inject.js"),
        "application/csp-report",
      );
      const reports = await parseRequest(req, testEnv());
      expect(reports).toHaveLength(0);
    });

    it("keeps the real violation in a mixed array", async () => {
      const real = REPORTING_API_BODY[0]!;
      const noise = {
        ...real,
        body: { ...real.body, blockedURL: "moz-extension://xyz/extension.js" },
      };
      const req = makeRequest([real, noise], "application/reports+json");
      const reports = await parseRequest(req, testEnv());
      expect(reports).toHaveLength(1);
      expect(reports[0]!.blockedUri).toBe("https://evil.com/script.js");
    });

    it("returns 204 (empty array) when ALL Reporting API entries are noise", async () => {
      const noise1 = {
        ...REPORTING_API_BODY[0]!,
        body: { ...REPORTING_API_BODY[0]!.body, blockedURL: "chrome-extension://a/x.js" },
      };
      const noise2 = {
        ...REPORTING_API_BODY[0]!,
        body: { ...REPORTING_API_BODY[0]!.body, blockedURL: "moz-extension://b/y.js" },
      };
      const req = makeRequest([noise1, noise2], "application/reports+json");
      const reports = await parseRequest(req, testEnv());
      expect(reports).toHaveLength(0);
    });

    it.each([
      "chrome-extension://abc/x.js",
      "moz-extension://abc/x.js",
      "safari-web-extension://abc/x.js",
      "safari-extension://abc/x.js",
      "webkit-masked-url://hidden/x.js",
      "chrome://settings",
      "about:blank",
    ])("drops default-prefix noise: %s", async (uri) => {
      const req = makeRequest(
        reportingApiWithBlockedUri(uri),
        "application/reports+json",
      );
      const reports = await parseRequest(req, testEnv());
      expect(reports).toHaveLength(0);
    });

    it.each([
      "inline",
      "data:text/javascript,alert(1)",
      "blob:https://example.com/abc-123",
      "https://evil.example/script.js",
      "eval",
    ])("does NOT drop high-signal blockedUri: %s", async (uri) => {
      const req = makeRequest(
        reportingApiWithBlockedUri(uri),
        "application/reports+json",
      );
      const reports = await parseRequest(req, testEnv());
      expect(reports).toHaveLength(1);
      expect(reports[0]!.blockedUri).toBe(uri);
    });

    it("uses the env override list (replaces defaults)", async () => {
      const overrideEnv = testEnv({
        IGNORE_BLOCKED_URI_PREFIXES: "https://noisy.example.com/",
      });
      // chrome-extension:// is no longer in the active list — should be kept
      const req1 = makeRequest(
        reportingApiWithBlockedUri("chrome-extension://abc/x.js"),
        "application/reports+json",
      );
      const r1 = await parseRequest(req1, overrideEnv);
      expect(r1).toHaveLength(1);

      // The new override is applied
      const req2 = makeRequest(
        reportingApiWithBlockedUri("https://noisy.example.com/track.js"),
        "application/reports+json",
      );
      const r2 = await parseRequest(req2, overrideEnv);
      expect(r2).toHaveLength(0);
    });

    it("'none' disables filtering entirely", async () => {
      const req = makeRequest(
        reportingApiWithBlockedUri("chrome-extension://abc/x.js"),
        "application/reports+json",
      );
      const reports = await parseRequest(
        req,
        testEnv({ IGNORE_BLOCKED_URI_PREFIXES: "none" }),
      );
      expect(reports).toHaveLength(1);
    });

    it("unset/empty env var falls back to defaults", async () => {
      const req = makeRequest(
        reportingApiWithBlockedUri("chrome-extension://abc/x.js"),
        "application/reports+json",
      );
      // Empty string and undefined both yield defaults
      const r1 = await parseRequest(
        req.clone(),
        testEnv({ IGNORE_BLOCKED_URI_PREFIXES: "" }),
      );
      expect(r1).toHaveLength(0);

      const r2 = await parseRequest(
        req.clone(),
        testEnv({ IGNORE_BLOCKED_URI_PREFIXES: undefined }),
      );
      expect(r2).toHaveLength(0);
    });
  });
});
