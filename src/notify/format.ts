/**
 * Notification formatters — plain text, HTML, webhook payloads.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NormalisedReport } from "../types";

/**
 * Format a report as a plain text email body.
 */
export function formatPlainText(report: NormalisedReport, workerUrl: string): string {
  const lines = [
    "CSP Violation Report",
    "====================",
    "",
    `Violated Directive:  ${report.violatedDirective}`,
    `Effective Directive: ${report.effectiveDirective}`,
    `Disposition:         ${report.disposition}`,
    "",
    `Document URI:  ${report.documentUri}`,
    `Blocked URI:   ${report.blockedUri}`,
    "",
    `Source File:    ${report.sourceFile || "(none)"}`,
    `Line:          ${report.lineNumber || "-"}`,
    `Column:        ${report.columnNumber || "-"}`,
    "",
    `Referrer:      ${report.referrer || "(none)"}`,
    `Status Code:   ${report.statusCode || "-"}`,
    `User Agent:    ${report.userAgent || "(none)"}`,
    `Report Format: ${report.sourceFormat}`,
    "",
    `Timestamp:     ${report.timestamp}`,
    `Report ID:     ${report.id}`,
    "",
    `Full report: ${workerUrl}/reports/${report.id}`,
    "",
    "---",
    `Original Policy: ${report.originalPolicy}`,
  ];
  return lines.join("\n");
}

/**
 * Format a report as an HTML email body.
 */
export function formatHtml(report: NormalisedReport, workerUrl: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #c0392b; margin-bottom: 4px;">⚠️ CSP Violation</h2>
  <p style="color: #666; margin-top: 0; font-size: 13px;">${esc(report.timestamp)}</p>

  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555; width: 160px;">Violated Directive</td>
      <td style="padding: 8px 12px;"><code style="background: #fef3f2; color: #c0392b; padding: 2px 6px; border-radius: 3px;">${esc(report.violatedDirective)}</code></td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Effective Directive</td>
      <td style="padding: 8px 12px;"><code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">${esc(report.effectiveDirective)}</code></td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Disposition</td>
      <td style="padding: 8px 12px;">${report.disposition === "report" ? "🔵 Report Only" : "🔴 Enforce"}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Document URI</td>
      <td style="padding: 8px 12px; word-break: break-all;">${esc(report.documentUri)}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Blocked URI</td>
      <td style="padding: 8px 12px; word-break: break-all; color: #c0392b; font-weight: 600;">${esc(report.blockedUri)}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Source File</td>
      <td style="padding: 8px 12px; word-break: break-all;">${esc(report.sourceFile || "(none)")}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Line / Column</td>
      <td style="padding: 8px 12px;">${report.lineNumber || "-"} / ${report.columnNumber || "-"}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Report Format</td>
      <td style="padding: 8px 12px;">${esc(report.sourceFormat)}</td>
    </tr>
  </table>

  <p style="margin-top: 16px;">
    <a href="${esc(workerUrl)}/reports/${esc(report.id)}" style="color: #2980b9; text-decoration: none;">View full report →</a>
  </p>

  <details style="margin-top: 12px; font-size: 12px; color: #888;">
    <summary>Original Policy</summary>
    <pre style="white-space: pre-wrap; word-break: break-all; background: #f9f9f9; padding: 10px; border-radius: 4px; margin-top: 8px; font-size: 11px;">${esc(report.originalPolicy)}</pre>
  </details>
</body>
</html>`;
}

/**
 * Format an email subject line.
 */
export function formatSubject(report: NormalisedReport): string {
  // Truncate document URI for readability
  let docUri = report.documentUri;
  try {
    const url = new URL(docUri);
    docUri = url.hostname + url.pathname;
  } catch {
    // Use as-is if not a valid URL
  }
  if (docUri.length > 60) docUri = docUri.slice(0, 57) + "...";

  return `CSP Violation: ${report.violatedDirective} on ${docUri}`;
}

/**
 * Format a webhook JSON payload (generic + Slack-compatible).
 */
export function formatWebhookPayload(
  report: NormalisedReport,
  workerUrl: string,
): Record<string, unknown> {
  const summary = `\`${report.violatedDirective}\` violation on ${report.documentUri} — blocked ${report.blockedUri}`;

  return {
    // Slack-compatible top-level text field
    text: summary,

    // Structured payload
    source: "csp-report-worker",
    event: "csp-violation",
    report,
    summary,
    dashboard_url: `${workerUrl}/reports/${report.id}`,
  };
}
