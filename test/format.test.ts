/**
 * Tests for notification formatters.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import {
  formatPlainText,
  formatHtml,
  formatSubject,
  formatWebhookPayload,
} from "../src/notify/format";
import type { NormalisedReport } from "../src/types";

const REPORT: NormalisedReport = {
  id: "abc123def456",
  timestamp: "2026-01-15T10:30:00.000Z",
  documentUri: "https://example.com/page",
  blockedUri: "https://evil.com/script.js",
  violatedDirective: "script-src",
  effectiveDirective: "script-src",
  originalPolicy: "script-src 'self'; report-uri /report",
  disposition: "enforce",
  referrer: "https://example.com/",
  sourceFile: "https://example.com/page",
  lineNumber: 12,
  columnNumber: 34,
  statusCode: 200,
  userAgent: "Mozilla/5.0 (Test)",
  sourceFormat: "report-uri",
};

const WORKER_URL = "https://csp.example.com";

describe("formatPlainText", () => {
  it("should include key violation details", () => {
    const text = formatPlainText(REPORT, WORKER_URL);
    expect(text).toContain("script-src");
    expect(text).toContain("https://evil.com/script.js");
    expect(text).toContain("https://example.com/page");
    expect(text).toContain("12"); // line number
    expect(text).toContain("abc123def456"); // report ID
    expect(text).toContain(`${WORKER_URL}/reports/abc123def456`);
  });

  it("should handle missing source file", () => {
    const noSource = { ...REPORT, sourceFile: "" };
    const text = formatPlainText(noSource, WORKER_URL);
    expect(text).toContain("(none)");
  });
});

describe("formatHtml", () => {
  it("should produce valid HTML with key fields", () => {
    const html = formatHtml(REPORT, WORKER_URL);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("script-src");
    expect(html).toContain("https://evil.com/script.js");
    expect(html).toContain("https://example.com/page");
    expect(html).toContain(`${WORKER_URL}/reports/abc123def456`);
  });

  it("should escape HTML entities", () => {
    const xss = { ...REPORT, blockedUri: '<script>alert("xss")</script>' };
    const html = formatHtml(xss, WORKER_URL);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("should show enforce vs report disposition", () => {
    const enforce = formatHtml(REPORT, WORKER_URL);
    expect(enforce).toContain("Enforce");

    const reportOnly = formatHtml({ ...REPORT, disposition: "report" }, WORKER_URL);
    expect(reportOnly).toContain("Report Only");
  });
});

describe("formatSubject", () => {
  it("should include directive and truncated document URI", () => {
    const subject = formatSubject(REPORT);
    expect(subject).toContain("script-src");
    expect(subject).toContain("example.com");
  });

  it("should truncate long document URIs", () => {
    const longUri = { ...REPORT, documentUri: "https://example.com/" + "a".repeat(100) };
    const subject = formatSubject(longUri);
    expect(subject.length).toBeLessThan(120);
    expect(subject).toContain("...");
  });
});

describe("formatWebhookPayload", () => {
  it("should include Slack-compatible text field", () => {
    const payload = formatWebhookPayload(REPORT, WORKER_URL);
    expect(payload.text).toBeDefined();
    expect(typeof payload.text).toBe("string");
    expect(payload.text as string).toContain("script-src");
  });

  it("should include structured fields", () => {
    const payload = formatWebhookPayload(REPORT, WORKER_URL);
    expect(payload.source).toBe("csp-report-worker");
    expect(payload.event).toBe("csp-violation");
    expect(payload.report).toBe(REPORT);
    expect(payload.dashboard_url).toBe(`${WORKER_URL}/reports/abc123def456`);
  });

  it("should include summary", () => {
    const payload = formatWebhookPayload(REPORT, WORKER_URL);
    expect(typeof payload.summary).toBe("string");
    expect(payload.summary as string).toContain("script-src");
    expect(payload.summary as string).toContain("https://evil.com/script.js");
  });
});
