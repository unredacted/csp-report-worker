/**
 * Notification formatters — plain text, HTML, webhook payloads.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NormalisedReport } from "../types";
import { classifyReport } from "../classify";

export type NotifyKind = "new" | "resurrection";

function kindHeader(kind: NotifyKind): string {
  return kind === "resurrection" ? "Resurrected" : "New";
}

/** Build the dashboard link. Prefers /issues/<issueId> when available
 *  (the triage view), falls back to /reports/<reportId> (raw event). */
function dashboardLink(workerUrl: string, reportId: string, issueId?: string): string {
  if (issueId) return `${workerUrl}/issues/${encodeURIComponent(issueId)}`;
  return `${workerUrl}/reports/${reportId}`;
}

/**
 * Format a report as a plain text email body.
 */
export function formatPlainText(
  report: NormalisedReport,
  workerUrl: string,
  kind: NotifyKind = "new",
  issueId?: string,
): string {
  const classification = classifyReport(report.blockedUri, report.documentUri, report.sourceFile);
  const lines = [
    `CSP Violation Report — ${kindHeader(kind)}`,
    "====================",
    "",
    `Violated Directive:  ${report.violatedDirective || "(unknown directive)"}`,
    `Effective Directive: ${report.effectiveDirective || "(unknown directive)"}`,
    `Disposition:         ${report.disposition}`,
    `Source:              ${classification.label}`,
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
    `${issueId ? "View issue" : "Full report"}: ${dashboardLink(workerUrl, report.id, issueId)}`,
    "",
    "---",
    `Original Policy: ${report.originalPolicy}`,
  ];
  return lines.join("\n");
}

/**
 * Format a report as an HTML email body.
 */
export function formatHtml(
  report: NormalisedReport,
  workerUrl: string,
  kind: NotifyKind = "new",
  issueId?: string,
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const classification = classifyReport(report.blockedUri, report.documentUri, report.sourceFile);
  const directive = report.violatedDirective || "(unknown directive)";
  const effective = report.effectiveDirective || "(unknown directive)";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #c0392b; margin-bottom: 4px;">⚠️ CSP Violation — ${kindHeader(kind)}</h2>
  <p style="color: #666; margin-top: 0; font-size: 13px;">${esc(report.timestamp)}</p>

  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555; width: 160px;">Violated Directive</td>
      <td style="padding: 8px 12px;"><code style="background: #fef3f2; color: #c0392b; padding: 2px 6px; border-radius: 3px;">${esc(directive)}</code></td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Effective Directive</td>
      <td style="padding: 8px 12px;"><code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">${esc(effective)}</code></td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Disposition</td>
      <td style="padding: 8px 12px;">${report.disposition === "report" ? "🔵 Report Only" : "🔴 Enforce"}</td>
    </tr>
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 8px 12px; font-weight: 600; color: #555;">Source</td>
      <td style="padding: 8px 12px;">${esc(classification.label)}</td>
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
    <a href="${esc(dashboardLink(workerUrl, report.id, issueId))}" style="color: #2980b9; text-decoration: none;">${issueId ? "View issue" : "View full report"} →</a>
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
 *
 * Subject design: [kind] directive — source descriptor — document.
 * The descriptor (`same-origin`, `external from evil.example`, `inline`,
 * `data: URI`, etc.) lets a SecOps engineer triage from the inbox alone,
 * without opening the email. The `[resurrected]` prefix tells operators
 * that this is a previously-resolved issue firing again.
 */
export function formatSubject(report: NormalisedReport, kind: NotifyKind = "new"): string {
  const directive = report.violatedDirective || "(unknown directive)";
  const classification = classifyReport(report.blockedUri, report.documentUri, report.sourceFile);

  let docUri = report.documentUri;
  try {
    const url = new URL(docUri);
    docUri = url.hostname + url.pathname;
  } catch {
    // Use as-is if not a valid URL
  }
  if (docUri.length > 60) docUri = docUri.slice(0, 57) + "...";

  const prefix = kind === "resurrection" ? "[resurrected] " : "";
  return `${prefix}CSP Violation: ${directive} — ${classification.label} on ${docUri}`;
}

/**
 * Format a webhook JSON payload (generic + Slack-compatible).
 */
export function formatWebhookPayload(
  report: NormalisedReport,
  workerUrl: string,
  kind: NotifyKind = "new",
  issueId?: string,
): Record<string, unknown> {
  const prefix = kind === "resurrection" ? "[resurrected] " : "";
  const summary = `${prefix}\`${report.violatedDirective}\` violation on ${report.documentUri} — blocked ${report.blockedUri}`;

  return {
    text: summary,
    source: "csp-report-worker",
    event: "csp-violation",
    kind,
    report,
    summary,
    dashboard_url: dashboardLink(workerUrl, report.id, issueId),
    issue_id: issueId ?? null,
  };
}
