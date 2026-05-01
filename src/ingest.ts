/**
 * Report ingestion — parse and normalise incoming CSP reports.
 *
 * Supports both legacy report-uri (application/csp-report) and
 * modern Reporting API v1 (application/reports+json) formats.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MAX_BODY_SIZE } from "./config";
import type {
  NormalisedReport,
  LegacyCspReportEnvelope,
  LegacyCspReportBody,
  ReportingApiEntry,
  ReportingApiBody,
} from "./types";

/**
 * Compute a deterministic SHA-256 ID for a report based on its content.
 * This is the report's storage ID — distinct from the dedup fingerprint.
 */
async function computeReportId(report: Omit<NormalisedReport, "id">): Promise<string> {
  const material = [
    report.timestamp,
    report.documentUri,
    report.blockedUri,
    report.violatedDirective,
    report.sourceFile,
    String(report.lineNumber),
    String(report.columnNumber),
    report.userAgent,
  ].join("|");

  const data = new TextEncoder().encode(material);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Parse an incoming request and return normalised report(s).
 *
 * @throws {Response} if the request is malformed or too large.
 */
export async function parseRequest(request: Request): Promise<NormalisedReport[]> {
  // --- Size check ---
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    throw new Response("Payload too large", { status: 413 });
  }

  // Read body with size guard
  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_SIZE) {
    throw new Response("Payload too large", { status: 413 });
  }

  if (!bodyText.trim()) {
    throw new Response("Empty body", { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Response("Invalid JSON", { status: 400 });
  }

  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  const userAgent = request.headers.get("user-agent") || "";
  const timestamp = new Date().toISOString();

  // --- Reporting API v1: application/reports+json ---
  if (contentType.includes("application/reports+json")) {
    if (!Array.isArray(parsed)) {
      throw new Response("Expected JSON array for Reporting API format", { status: 400 });
    }
    return parseReportingApiArray(parsed as ReportingApiEntry[], userAgent, timestamp);
  }

  // --- Legacy report-uri: application/csp-report ---
  if (contentType.includes("application/csp-report")) {
    const envelope = parsed as LegacyCspReportEnvelope;
    const body = envelope["csp-report"];
    if (!body || typeof body !== "object") {
      throw new Response('Missing "csp-report" key in body', { status: 400 });
    }
    const report = await normaliseLegacy(body, userAgent, timestamp);
    return [report];
  }

  // --- Fallback: try to auto-detect ---
  if (Array.isArray(parsed)) {
    return parseReportingApiArray(parsed as ReportingApiEntry[], userAgent, timestamp);
  }
  if (typeof parsed === "object" && parsed !== null && "csp-report" in parsed) {
    const body = (parsed as LegacyCspReportEnvelope)["csp-report"];
    if (body && typeof body === "object") {
      const report = await normaliseLegacy(body, userAgent, timestamp);
      return [report];
    }
  }

  throw new Response("Unrecognised report format", { status: 400 });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function parseReportingApiArray(
  entries: ReportingApiEntry[],
  userAgent: string,
  timestamp: string,
): Promise<NormalisedReport[]> {
  // Filter for CSP violation entries only
  const cspEntries = entries.filter(
    (e) => e.type === "csp-violation" && e.body && typeof e.body === "object",
  );

  if (cspEntries.length === 0) {
    throw new Response("No csp-violation entries in Reporting API payload", { status: 400 });
  }

  const reports: NormalisedReport[] = [];
  for (const entry of cspEntries) {
    reports.push(await normaliseReportingApi(entry.body, userAgent, timestamp));
  }
  return reports;
}

async function normaliseLegacy(
  body: LegacyCspReportBody,
  userAgent: string,
  timestamp: string,
): Promise<NormalisedReport> {
  const partial = {
    timestamp,
    documentUri: body["document-uri"] || "",
    blockedUri: body["blocked-uri"] || "",
    violatedDirective: body["violated-directive"] || body["effective-directive"] || "",
    effectiveDirective: body["effective-directive"] || body["violated-directive"] || "",
    originalPolicy: body["original-policy"] || "",
    disposition: normaliseDisposition(body.disposition),
    referrer: body.referrer || "",
    sourceFile: body["source-file"] || "",
    lineNumber: body["line-number"] || 0,
    columnNumber: body["column-number"] || 0,
    statusCode: body["status-code"] || 0,
    userAgent,
    sourceFormat: "report-uri" as const,
  };

  const id = await computeReportId(partial);
  return { id, ...partial };
}

async function normaliseReportingApi(
  body: ReportingApiBody,
  userAgent: string,
  timestamp: string,
): Promise<NormalisedReport> {
  const partial = {
    timestamp,
    documentUri: body.documentURL || body["document-uri"] || "",
    blockedUri: body.blockedURL || body["blocked-uri"] || "",
    violatedDirective: body.violatedDirective || body.effectiveDirective || "",
    effectiveDirective: body.effectiveDirective || body.violatedDirective || "",
    originalPolicy: body.originalPolicy || "",
    disposition: normaliseDisposition(body.disposition),
    referrer: body.referrer || "",
    sourceFile: body.sourceFile || "",
    lineNumber: body.lineNumber || 0,
    columnNumber: body.columnNumber || 0,
    statusCode: body.statusCode || 0,
    userAgent,
    sourceFormat: "report-to" as const,
  };

  const id = await computeReportId(partial);
  return { id, ...partial };
}

function normaliseDisposition(d?: string): "enforce" | "report" {
  if (d === "report") return "report";
  return "enforce";
}
