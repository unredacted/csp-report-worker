/**
 * Tests for the notification mute gate (shouldNotify).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { shouldNotify } from "../src/notify/index";
import type { Env, NormalisedReport } from "../src/types";

function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ...overrides } as Env;
}

function makeReport(overrides?: Partial<NormalisedReport>): NormalisedReport {
  return {
    id: "abc123",
    timestamp: "2026-05-01T00:00:00.000Z",
    documentUri: "https://example.com/page",
    blockedUri: "https://evil.example/script.js",
    violatedDirective: "script-src",
    effectiveDirective: "script-src",
    originalPolicy: "script-src 'self'",
    disposition: "enforce",
    referrer: "",
    sourceFile: "https://example.com/page",
    lineNumber: 1,
    columnNumber: 1,
    statusCode: 200,
    userAgent: "TestAgent/1.0",
    sourceFormat: "report-uri",
    ...overrides,
  };
}

describe("shouldNotify (notification mute gate)", () => {
  describe("default mute list", () => {
    it.each([
      "chrome-extension://abc/x.js",
      "moz-extension://abc/x.js",
      "safari-web-extension://abc/x.js",
      "safari-extension://abc/x.js",
      "webkit-masked-url://hidden/x.js",
      "chrome://settings",
      "about:blank",
    ])("mutes notifications for %s", (uri) => {
      const report = makeReport({ blockedUri: uri });
      expect(shouldNotify(testEnv(), report)).toBe(false);
    });

    it.each([
      "https://evil.example/script.js",
      "data:text/javascript,alert(1)",
      "blob:https://example.com/abc-123",
      "inline",
      "eval",
    ])("does NOT mute notifications for high-signal blockedUri: %s", (uri) => {
      const report = makeReport({ blockedUri: uri });
      expect(shouldNotify(testEnv(), report)).toBe(true);
    });
  });

  describe("env-var override", () => {
    it("replaces the default list when MUTE_BLOCKED_URI_PREFIXES is set", () => {
      const overrideEnv = testEnv({
        MUTE_BLOCKED_URI_PREFIXES: "https://noisy.example.com/",
      });
      // chrome-extension:// is no longer muted
      expect(
        shouldNotify(overrideEnv, makeReport({ blockedUri: "chrome-extension://abc/x.js" })),
      ).toBe(true);
      // The new prefix is muted
      expect(
        shouldNotify(
          overrideEnv,
          makeReport({ blockedUri: "https://noisy.example.com/track.js" }),
        ),
      ).toBe(false);
    });

    it("'none' (case-insensitive) disables muting", () => {
      const lower = testEnv({ MUTE_BLOCKED_URI_PREFIXES: "none" });
      const upper = testEnv({ MUTE_BLOCKED_URI_PREFIXES: "NONE" });
      const r = makeReport({ blockedUri: "chrome-extension://abc/x.js" });
      expect(shouldNotify(lower, r)).toBe(true);
      expect(shouldNotify(upper, r)).toBe(true);
    });

    it("falls back to defaults when env var is unset, empty, or whitespace", () => {
      const r = makeReport({ blockedUri: "chrome-extension://abc/x.js" });
      expect(shouldNotify(testEnv({ MUTE_BLOCKED_URI_PREFIXES: undefined }), r)).toBe(false);
      expect(shouldNotify(testEnv({ MUTE_BLOCKED_URI_PREFIXES: "" }), r)).toBe(false);
      expect(shouldNotify(testEnv({ MUTE_BLOCKED_URI_PREFIXES: "   " }), r)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("notifies when blockedUri is empty (inline-style violation)", () => {
      // Empty blockedUri is treated as inline — not muted by the default list.
      expect(shouldNotify(testEnv(), makeReport({ blockedUri: "" }))).toBe(true);
    });
  });
});
