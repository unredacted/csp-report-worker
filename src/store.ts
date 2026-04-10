/**
 * KV storage — read/write normalised reports.
 *
 * Key design:
 *   report:{invertedTimestamp}:{id}  →  full report JSON  (TTL-based expiry)
 *   idx:{id}                         →  report key         (pointer for O(1) lookups by ID)
 *
 * Inverted timestamp = 9999999999999 - Date.now() ensures lexicographic
 * ordering yields newest-first, which aligns with KV list() cursor pagination.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { INVERTED_TS_CEILING } from "./config";
import type { NormalisedReport, ListReportsResponse } from "./types";

/**
 * Build the primary KV key for a report.
 */
function reportKey(report: NormalisedReport): string {
  const ts = new Date(report.timestamp).getTime();
  const inverted = String(INVERTED_TS_CEILING - ts).padStart(13, "0");
  return `report:${inverted}:${report.id}`;
}

/**
 * Build the index key for ID-based lookups.
 */
function indexKey(id: string): string {
  return `idx:${id}`;
}

/**
 * Store a normalised report in KV.
 * Writes both the primary key and the index pointer.
 */
export async function storeReport(
  kv: KVNamespace,
  report: NormalisedReport,
  ttlSeconds: number,
): Promise<void> {
  const primary = reportKey(report);
  const json = JSON.stringify(report);

  await Promise.all([
    kv.put(primary, json, { expirationTtl: ttlSeconds }),
    kv.put(indexKey(report.id), primary, { expirationTtl: ttlSeconds }),
  ]);
}

/**
 * Fetch a single report by its ID.
 */
export async function getReport(
  kv: KVNamespace,
  id: string,
): Promise<NormalisedReport | null> {
  // Look up the primary key via the index
  const primary = await kv.get(indexKey(id));
  if (!primary) return null;

  const report = await kv.get<NormalisedReport>(primary, "json");
  return report;
}

/**
 * List recent reports with optional filtering and pagination.
 */
export async function listReports(
  kv: KVNamespace,
  options: {
    limit?: number;
    cursor?: string;
    directive?: string;
  } = {},
): Promise<ListReportsResponse> {
  const requestLimit = Math.min(Math.max(options.limit || 50, 1), 200);

  // We may need to over-fetch if filtering by directive, since KV
  // doesn't support value-based filtering natively.
  const fetchLimit = options.directive ? requestLimit * 3 : requestLimit;

  const listResult = await kv.list({
    prefix: "report:",
    limit: Math.min(fetchLimit, 1000),
    cursor: options.cursor || undefined,
  });

  const reports: NormalisedReport[] = [];

  for (const key of listResult.keys) {
    if (reports.length >= requestLimit) break;

    const report = await kv.get<NormalisedReport>(key.name, "json");
    if (!report) continue;

    // Apply directive filter if specified
    if (options.directive && report.violatedDirective !== options.directive) {
      continue;
    }

    reports.push(report);
  }

  return {
    reports,
    cursor: listResult.list_complete ? null : (listResult.cursor || null),
  };
}
