/**
 * Wire-format types for the dashboard.
 *
 * These mirror the Worker's internal NormalisedReport / ListReportsResponse
 * but are duplicated here so the SPA tsconfig stays decoupled from the
 * Worker tsconfig. If you change the Worker schema, update this file too.
 */

export type ReportCategory =
  | "extension"
  | "browser-internal"
  | "inline"
  | "data"
  | "blob"
  | "eval"
  | "same-origin"
  | "external"
  | "unknown";

export interface NormalisedReport {
  id: string;
  timestamp: string;
  documentUri: string;
  blockedUri: string;
  violatedDirective: string;
  effectiveDirective: string;
  originalPolicy: string;
  disposition: "enforce" | "report";
  referrer: string;
  sourceFile: string;
  lineNumber: number;
  columnNumber: number;
  statusCode: number;
  userAgent: string;
  sourceFormat: "report-uri" | "report-to";
  category: ReportCategory;
}

export interface ListReportsResponse {
  reports: NormalisedReport[];
  cursor: string | null;
}

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  "extension",
  "browser-internal",
  "inline",
  "data",
  "blob",
  "eval",
  "same-origin",
  "external",
  "unknown",
];

// ---------------------------------------------------------------------------
// Issues + properties (D1-backed) — mirror of src/types.ts on the worker side.
// ---------------------------------------------------------------------------

export type IssueStatus = "open" | "acknowledged" | "ignored" | "resolved";

export interface Issue {
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

export interface IssueEvent {
  id: number;
  issueId: string;
  reportId: string;
  ts: string;
  userAgent: string | null;
  statusCode: number | null;
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

export const ISSUE_STATUSES: readonly IssueStatus[] = [
  "open",
  "acknowledged",
  "ignored",
  "resolved",
];

export interface Property {
  id: string;
  slug: string;
  name: string;
  notifyEmails: string | null;
  notifyWebhooks: string | null;
  muteCategories: string | null;
  createdAt: string;
  archivedAt: string | null;
  /** Suffix-redacted token in list responses, full token only on create + rotate. */
  ingestTokenSuffix?: string;
  /** Full token — only present in createProperty / rotateIngestToken responses. */
  ingestToken?: string;
}

export interface ListPropertiesResponse {
  properties: Property[];
}

export interface PropertyResponse {
  property: Property;
}

export interface PolicySuggestionToken {
  value: string;
  category: ReportCategory;
  issueCount: number;
  eventCount: number;
  issueIds: string[];
  riskWarning: boolean;
}

export interface PolicySuggestionGroup {
  directive: string;
  tokens: PolicySuggestionToken[];
}

export interface PolicySuggestions {
  groups: PolicySuggestionGroup[];
}

export interface PolicySelection {
  directive: string;
  value: string;
}

export interface PolicyPreviewResponse {
  policy: string;
}
