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
