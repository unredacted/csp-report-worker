/**
 * Classify a CSP report by the kind of source that produced the violation.
 *
 * The category is derived from `blockedUri` (with `documentUri` for
 * same-origin detection) and is stored on every NormalisedReport so the
 * `/reports` API and the dashboard can filter by it. The same classifier
 * also drives the email subject decoration in src/notify/format.ts.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
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

export interface ReportClassification {
  /** The bucket this report falls into. */
  category: ReportCategory;
  /** Human-readable descriptor for use in subjects, badges, and bodies. */
  label: string;
  /** Hostname extracted from `blockedUri` when applicable, otherwise null. */
  hostname: string | null;
}

const EXTENSION_PREFIXES = [
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
  "safari-extension://",
  "webkit-masked-url://",
];

const BROWSER_INTERNAL_PREFIXES = ["chrome://", "about:"];

/**
 * Classify a `blockedUri` relative to its `documentUri`.
 *
 * Order of detection matters: extension and browser-internal schemes are
 * checked first so they are never mis-bucketed as "external".
 */
export function classifyReport(
  blockedUri: string,
  documentUri: string,
): ReportClassification {
  const raw = (blockedUri || "").trim();

  if (EXTENSION_PREFIXES.some((p) => raw.startsWith(p))) {
    return { category: "extension", label: "browser extension", hostname: null };
  }
  if (BROWSER_INTERNAL_PREFIXES.some((p) => raw.startsWith(p))) {
    return { category: "browser-internal", label: "browser-internal", hostname: null };
  }
  if (raw === "" || raw.toLowerCase() === "inline") {
    return { category: "inline", label: "inline", hostname: null };
  }
  if (raw.toLowerCase() === "eval") {
    return { category: "eval", label: "eval", hostname: null };
  }
  if (raw.startsWith("data:")) {
    return { category: "data", label: "data: URI", hostname: null };
  }
  if (raw.startsWith("blob:")) {
    return { category: "blob", label: "blob: URL", hostname: null };
  }

  let blockedHost: string | null = null;
  try {
    blockedHost = new URL(raw).hostname || null;
  } catch {
    blockedHost = null;
  }
  let docHost: string | null = null;
  try {
    docHost = new URL(documentUri).hostname || null;
  } catch {
    docHost = null;
  }

  if (!blockedHost) {
    return { category: "unknown", label: raw || "unknown", hostname: null };
  }
  if (docHost && blockedHost === docHost) {
    return { category: "same-origin", label: "same-origin", hostname: blockedHost };
  }
  return {
    category: "external",
    label: `external from ${blockedHost}`,
    hostname: blockedHost,
  };
}

/** All categories, useful for iteration in the API and UI. */
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

/** Type guard for a string that comes off the wire. */
export function isReportCategory(value: string): value is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value);
}
