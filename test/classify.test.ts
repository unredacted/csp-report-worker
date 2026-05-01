/**
 * Tests for the report classifier (src/classify.ts).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { classifyReport, isReportCategory, REPORT_CATEGORIES } from "../src/classify";

const DOC = "https://example.com/page";

describe("classifyReport", () => {
  describe("extension prefixes", () => {
    it.each([
      ["chrome-extension://abc/x.js"],
      ["moz-extension://abc/x.js"],
      ["safari-web-extension://abc/x.js"],
      ["safari-extension://abc/x.js"],
      ["webkit-masked-url://hidden/x.js"],
    ])("classifies %s as 'extension'", (uri) => {
      const c = classifyReport(uri, DOC);
      expect(c.category).toBe("extension");
      expect(c.label).toBe("browser extension");
      expect(c.hostname).toBeNull();
    });
  });

  describe("browser-internal", () => {
    it.each([["chrome://settings"], ["about:blank"], ["about:srcdoc"]])(
      "classifies %s as 'browser-internal'",
      (uri) => {
        const c = classifyReport(uri, DOC);
        expect(c.category).toBe("browser-internal");
        expect(c.label).toBe("browser-internal");
      },
    );
  });

  describe("inline / eval / data / blob", () => {
    it("empty blockedUri is 'inline'", () => {
      expect(classifyReport("", DOC).category).toBe("inline");
    });
    it("'inline' literal is 'inline'", () => {
      expect(classifyReport("inline", DOC).category).toBe("inline");
    });
    it("'eval' literal is 'eval'", () => {
      expect(classifyReport("eval", DOC).category).toBe("eval");
    });
    it("data: URI is 'data'", () => {
      const c = classifyReport("data:text/javascript,alert(1)", DOC);
      expect(c.category).toBe("data");
      expect(c.label).toBe("data: URI");
    });
    it("blob: URL is 'blob'", () => {
      const c = classifyReport("blob:https://example.com/abc", DOC);
      expect(c.category).toBe("blob");
      expect(c.label).toBe("blob: URL");
    });
  });

  describe("same-origin vs external", () => {
    it("matching host -> 'same-origin'", () => {
      const c = classifyReport("https://example.com/forbidden.js", DOC);
      expect(c.category).toBe("same-origin");
      expect(c.hostname).toBe("example.com");
    });
    it("different host -> 'external' with hostname extracted", () => {
      const c = classifyReport("https://evil.example/script.js", DOC);
      expect(c.category).toBe("external");
      expect(c.hostname).toBe("evil.example");
      expect(c.label).toBe("external from evil.example");
    });
    it("malformed URL -> 'unknown'", () => {
      const c = classifyReport("not-a-url", DOC);
      expect(c.category).toBe("unknown");
    });
  });

  describe("ordering — extension takes precedence over external", () => {
    // A chrome-extension:// URI happens to parse as a URL with hostname.
    // The classifier MUST identify it as extension, not external.
    it("chrome-extension://abc/x.js never falls through to 'external'", () => {
      const c = classifyReport("chrome-extension://abc/x.js", DOC);
      expect(c.category).toBe("extension");
    });
  });

  describe("sourceFile attribution — extension-injected scripts hitting external hosts", () => {
    // The case the dashboard caught: blockedUri is a perfectly normal
    // wss://walletlink.org/rpc, but the script that initiated the
    // connection came from a Chrome extension. That's still extension noise
    // and must be muted.
    it("extension sourceFile + external blockedUri => 'extension'", () => {
      const c = classifyReport(
        "wss://www.walletlink.org/rpc",
        DOC,
        "chrome-extension://abc/inject.js",
      );
      expect(c.category).toBe("extension");
    });

    it("Chrome's redacted source format (no //) is recognised", () => {
      const c = classifyReport(
        "wss://www.walletlink.org/rpc",
        DOC,
        "chrome-extension:2:248774",
      );
      expect(c.category).toBe("extension");
    });

    it("Chrome's bare-scheme source (just 'chrome-extension') is recognised", () => {
      // Some Chrome versions put the bare scheme in sourceFile and the
      // location info in lineNumber/columnNumber instead of formatting them
      // into the URI. The classifier must still recognise the source as an
      // extension.
      const c = classifyReport("wss://www.walletlink.org/rpc", DOC, "chrome-extension");
      expect(c.category).toBe("extension");
    });

    it("moz-extension sourceFile is recognised", () => {
      const c = classifyReport(
        "https://api.example.com/x",
        DOC,
        "moz-extension://abcd-1234/content.js",
      );
      expect(c.category).toBe("extension");
    });

    it("browser-internal sourceFile is recognised", () => {
      const c = classifyReport(
        "https://api.example.com/x",
        DOC,
        "chrome://newtab/script.js",
      );
      expect(c.category).toBe("browser-internal");
    });

    it("legitimate page sourceFile keeps the URL-based classification", () => {
      const c = classifyReport(
        "https://evil.example/x.js",
        DOC,
        "https://example.com/main.js",
      );
      expect(c.category).toBe("external");
    });

    it("absent sourceFile leaves blockedUri-based classification intact", () => {
      const c = classifyReport("https://evil.example/x.js", DOC);
      expect(c.category).toBe("external");
    });
  });
});

describe("isReportCategory", () => {
  it("accepts every value in REPORT_CATEGORIES", () => {
    for (const cat of REPORT_CATEGORIES) {
      expect(isReportCategory(cat)).toBe(true);
    }
  });
  it("rejects unknown strings", () => {
    expect(isReportCategory("nope")).toBe(false);
    expect(isReportCategory("")).toBe(false);
    expect(isReportCategory("Extension")).toBe(false); // case-sensitive
  });
});
