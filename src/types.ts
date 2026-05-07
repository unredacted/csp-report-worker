/**
 * Shared TypeScript types for csp-report-worker.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface Env {
  // Allow dynamic KV namespace bindings + D1 binding
  [key: string]: unknown;

  // Cloudflare send_email binding — used by both EMAIL_PROVIDER = "cloudflare-email"
  // (Email Service, structured payload) and "cloudflare-routing" (Email Routing, raw MIME).
  EMAIL?: SendEmail;

  // Cloudflare Workers Assets binding for the dashboard SPA. Configured in
  // wrangler.toml under [assets]; absent in unit-test envs.
  ASSETS?: Fetcher;

  // D1 database for issues, properties, and per-issue event samples.
  // Conventional binding name; getD1() in src/db.ts also matches by
  // constructor so users can rename without code changes.
  DB?: D1Database;

  // --- Vars ---
  NOTIFY_EMAILS: string;
  NOTIFY_WEBHOOKS: string;
  DEDUP_WINDOW_MINUTES: string;
  KV_TTL_SECONDS: string;
  ALLOWED_ORIGINS: string;
  EMAIL_FROM: string;
  MUTE_CATEGORIES?: string;

  // Per-issue rolling event sample cap (default 100). See src/config.ts.
  EVENT_SAMPLE_CAP?: string;

  // Hours to suppress notifications after `resolved` before a new report
  // resurrects the issue (default 24). Replaces DEDUP_WINDOW_MINUTES.
  RESURRECTION_GRACE_HOURS?: string;

  // Days to retain issues. Older issues are deleted by the scheduled
  // handler. Default 90; set to "0" to disable retention.
  RETENTION_DAYS?: string;

  // JSON list seeded at first request when `properties` table is empty.
  // M4 will wire this up; declared in M1 so the type is stable.
  BOOTSTRAP_PROPERTIES?: string;

  // --- Email provider selection ---
  // "cloudflare-email" | "cloudflare-routing" | "mailgun" | "ses" | "resend" (empty = email disabled)
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

// ---------------------------------------------------------------------------
// Properties + Issues (D1)
// ---------------------------------------------------------------------------

export interface Property {
  id: string;
  slug: string;
  name: string;
  /** Bearer token required for /r/{slug} ingest. Empty string for `default`. */
  ingestToken: string;
  /** CSV override for global NOTIFY_EMAILS, or null to fall back. */
  notifyEmails: string | null;
  /** CSV override for global NOTIFY_WEBHOOKS, or null to fall back. */
  notifyWebhooks: string | null;
  /** CSV override for global MUTE_CATEGORIES, or null to fall back. */
  muteCategories: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export type IssueStatus = "open" | "acknowledged" | "ignored" | "resolved";

export interface Issue {
  /** Composite id: `${property_id}:${fingerprint}`. */
  id: string;
  propertyId: string;
  fingerprint: string;
  status: IssueStatus;
  category: ReportCategory;
  violatedDirective: string;
  effectiveDirective: string;
  blockedUri: string;
  documentUri: string;
  sourceFile: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  sampleTitle: string;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
  resurrectedAt: string | null;
  eventCount: number;
  notifiedAt: string | null;
}

/** Sampled event row tied to an issue — capped at EVENT_SAMPLE_CAP per issue. */
export interface IssueEvent {
  id: number;
  issueId: string;
  reportId: string;
  ts: string;
  userAgent: string | null;
  statusCode: number | null;
  /** Cloudflare context — never an IP address. */
  country: string | null;
  asn: number | null;
  asOrg: string | null;
  colo: string | null;
  cfRay: string | null;
  httpProtocol: string | null;
}

export interface AggregateBucket {
  label: string;
  count: number;
}

/** Top-N breakdowns derived from the per-issue event sample. */
export interface IssueAggregates {
  countries: AggregateBucket[];
  asns: AggregateBucket[];
  browsers: AggregateBucket[];
}

export interface ListIssuesResponse {
  issues: Issue[];
  cursor: string | null;
}

export interface IssueDetailResponse {
  issue: Issue;
  events: IssueEvent[];
  aggregates: IssueAggregates;
}

export type { ReportCategory } from "./classify";
