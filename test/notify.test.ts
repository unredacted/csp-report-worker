/**
 * Tests for the notification mute gate (shouldNotify).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { shouldNotify } from "../src/notify/index";
import type { Env, NormalisedReport } from "../src/types";
import type { ReportCategory } from "../src/classify";

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
    category: "external",
    ...overrides,
  };
}

describe("shouldNotify (notification mute gate, category-based)", () => {
  describe("default mute set", () => {
    it.each([["extension"], ["browser-internal"]] as const)(
      "mutes %s by default",
      (cat) => {
        expect(
          shouldNotify(testEnv(), makeReport({ category: cat as ReportCategory })),
        ).toBe(false);
      },
    );

    it.each([
      ["external"],
      ["same-origin"],
      ["inline"],
      ["data"],
      ["blob"],
      ["eval"],
      ["unknown"],
    ] as const)("does NOT mute %s by default", (cat) => {
      expect(
        shouldNotify(testEnv(), makeReport({ category: cat as ReportCategory })),
      ).toBe(true);
    });
  });

  describe("MUTE_CATEGORIES env override", () => {
    it("replaces the default list when set", () => {
      const overrideEnv = testEnv({ MUTE_CATEGORIES: "external" });
      // extension is no longer muted
      expect(
        shouldNotify(overrideEnv, makeReport({ category: "extension" })),
      ).toBe(true);
      // external IS now muted
      expect(
        shouldNotify(overrideEnv, makeReport({ category: "external" })),
      ).toBe(false);
    });

    it("'none' (case-insensitive) disables muting", () => {
      const lower = testEnv({ MUTE_CATEGORIES: "none" });
      const upper = testEnv({ MUTE_CATEGORIES: "NONE" });
      const r = makeReport({ category: "extension" });
      expect(shouldNotify(lower, r)).toBe(true);
      expect(shouldNotify(upper, r)).toBe(true);
    });

    it("falls back to defaults when unset, empty, or whitespace", () => {
      const r = makeReport({ category: "extension" });
      expect(shouldNotify(testEnv({ MUTE_CATEGORIES: undefined }), r)).toBe(false);
      expect(shouldNotify(testEnv({ MUTE_CATEGORIES: "" }), r)).toBe(false);
      expect(shouldNotify(testEnv({ MUTE_CATEGORIES: "   " }), r)).toBe(false);
    });

    it("accepts a comma-separated list of multiple categories", () => {
      const e = testEnv({ MUTE_CATEGORIES: "extension,external" });
      expect(shouldNotify(e, makeReport({ category: "extension" }))).toBe(false);
      expect(shouldNotify(e, makeReport({ category: "external" }))).toBe(false);
      expect(shouldNotify(e, makeReport({ category: "inline" }))).toBe(true);
    });
  });
});
