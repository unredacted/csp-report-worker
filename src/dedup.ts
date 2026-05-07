/**
 * Fingerprint computation for issue grouping.
 *
 * Earlier versions also tracked a per-fingerprint dedup window in KV
 * (`dedup:{fingerprint}` keys with count + firstSeen). M3 dropped that —
 * D1 issues are now the dedup truth, and notifications gate on issue
 * status transitions instead. computeFingerprint stays because issues.ts
 * uses it as the per-property issue id.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NormalisedReport } from "./types";

/**
 * Compute a dedup fingerprint for a report.
 *
 * Groups reports that describe the same violation on the same page
 * from the same source location:
 *   SHA-256(blockedUri | violatedDirective | documentUri | sourceFile:lineNumber)
 */
export async function computeFingerprint(report: NormalisedReport): Promise<string> {
  const material = [
    report.blockedUri,
    report.violatedDirective,
    report.documentUri,
    `${report.sourceFile}:${report.lineNumber}`,
  ].join("|");

  const data = new TextEncoder().encode(material);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
