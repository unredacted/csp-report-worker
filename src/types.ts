/**
 * Shared TypeScript types for csp-report-worker.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface Env {
  // Allow dynamic KV namespace bindings
  [key: string]: unknown;

  // Cloudflare Send Email binding (optional — only needed for EMAIL_PROVIDER = "cloudflare")
  EMAIL?: SendEmail;

  // --- Vars ---
  NOTIFY_EMAILS: string;
  NOTIFY_WEBHOOKS: string;
  DEDUP_WINDOW_MINUTES: string;
  KV_TTL_SECONDS: string;
  ALLOWED_ORIGINS: string;
  EMAIL_FROM: string;
  MUTE_BLOCKED_URI_PREFIXES?: string;

  // --- Email provider selection ---
  // "cloudflare" | "mailgun" | "ses" | "resend" (empty = email disabled)
  EMAIL_PROVIDER?: string;

  // --- Mailgun (if EMAIL_PROVIDER = "mailgun") ---
  MAILGUN_DOMAIN?: string;
  MAILGUN_REGION?: string; // "us" | "eu"
  MAILGUN_API_KEY?: string; // secret

  // --- AWS SES (if EMAIL_PROVIDER = "ses") ---
  AWS_SES_REGION?: string;
  AWS_SES_ACCESS_KEY_ID?: string;     // secret
  AWS_SES_SECRET_ACCESS_KEY?: string; // secret

  // --- Resend (if EMAIL_PROVIDER = "resend") ---
  RESEND_API_KEY?: string; // secret

  // --- Secrets (set via `wrangler secret put`) ---
  API_TOKEN: string;
}

// ---------------------------------------------------------------------------
// Normalised CSP Report (internal schema)
// ---------------------------------------------------------------------------

import type { ReportCategory } from "./classify";

export interface NormalisedReport {
  /** Deterministic SHA-256 hash used for dedup */
  id: string;
  /** ISO-8601 timestamp of ingestion */
  timestamp: string;
  /** The URI of the document where the violation occurred */
  documentUri: string;
  /** The URI that was blocked */
  blockedUri: string;
  /** The directive that was violated (as written in the policy) */
  violatedDirective: string;
  /** The effective directive (normalised by the browser) */
  effectiveDirective: string;
  /** The full original policy string */
  originalPolicy: string;
  /** Whether the policy was enforce or report-only */
  disposition: "enforce" | "report";
  /** The referrer of the document */
  referrer: string;
  /** The source file that triggered the violation */
  sourceFile: string;
  /** Line number in the source file */
  lineNumber: number;
  /** Column number in the source file */
  columnNumber: number;
  /** HTTP status code of the document */
  statusCode: number;
  /** User-Agent string from the request header */
  userAgent: string;
  /** Which report format the browser sent */
  sourceFormat: "report-uri" | "report-to";
  /** Source bucket — derived at ingestion from blockedUri + documentUri */
  category: ReportCategory;
}

// ---------------------------------------------------------------------------
// Legacy CSP Report (report-uri format)
// ---------------------------------------------------------------------------

/**
 * Shape of the inner object in `{ "csp-report": { ... } }`.
 * Field names use the kebab-case keys browsers actually send.
 */
export interface LegacyCspReportBody {
  "document-uri"?: string;
  "blocked-uri"?: string;
  "violated-directive"?: string;
  "effective-directive"?: string;
  "original-policy"?: string;
  disposition?: string;
  referrer?: string;
  "source-file"?: string;
  "line-number"?: number;
  "column-number"?: number;
  "status-code"?: number;
}

export interface LegacyCspReportEnvelope {
  "csp-report"?: LegacyCspReportBody;
}

// ---------------------------------------------------------------------------
// Reporting API v1 (report-to format)
// ---------------------------------------------------------------------------

export interface ReportingApiBody {
  documentURL?: string;
  blockedURL?: string;
  violatedDirective?: string;
  effectiveDirective?: string;
  originalPolicy?: string;
  disposition?: string;
  referrer?: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  statusCode?: number;
  // Some browsers use different casing
  "document-uri"?: string;
  "blocked-uri"?: string;
}

export interface ReportingApiEntry {
  type: string;
  age?: number;
  url?: string;
  user_agent?: string;
  body: ReportingApiBody;
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

export interface DedupEntry {
  count: number;
  firstSeen: string;
}

// ---------------------------------------------------------------------------
// API Responses
// ---------------------------------------------------------------------------

export interface ListReportsResponse {
  reports: NormalisedReport[];
  cursor: string | null;
}

export interface ErrorResponse {
  error: string;
}
