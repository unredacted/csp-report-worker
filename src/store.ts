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
import { classifyReport, type ReportCategory } from "./classify";
import type { NormalisedReport, ListReportsResponse } from "./types";

/**
 * Backfill fields that may be missing on records written by older Worker
 * versions:
 *   - `category` (added in the category-tagging commit)
 *   - `violatedDirective` when the modern Reporting API only sent
 *     `effectiveDirective` and the previous code left it empty
 *
 * The classifier is deterministic and uses fields every record already has,
 * so this is safe to run on every read. Records get rewritten to KV on
 * normal ingestion of new violations and age out on their own (KV TTL),
 * so we don't write the migrated record back — read-side fix only.
 */
function backfillReport(r: NormalisedReport): NormalisedReport {
  let migrated = r;
  // Reclassify if the stored category is missing OR was assigned by an
  // earlier classifier that didn't consider sourceFile. Re-running the
  // classifier is cheap and handles both the schema-migration case and
  // the corrected-classification case in one pass.
  const correct = classifyReport(
    migrated.blockedUri,
    migrated.documentUri,
    migrated.sourceFile,
  ).category;
  if (migrated.category !== correct) {
    migrated = { ...migrated, category: correct };
  }
  if (!migrated.violatedDirective && migrated.effectiveDirective) {
    migrated = { ...migrated, violatedDirective: migrated.effectiveDirective };
  }
  return migrated;
}

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
  return report ? backfillReport(report) : null;
}

/**
 * List recent reports with optional filtering and pagination.
 *
 * `categories` is treated as an inclusive set: a report is kept if its
 * category is in the set. An empty/undefined set means "no category filter".
 */
export async function listReports(
  kv: KVNamespace,
  options: {
    limit?: number;
    cursor?: string;
    directive?: string;
    categories?: readonly ReportCategory[];
  } = {},
): Promise<ListReportsResponse> {
  const requestLimit = Math.min(Math.max(options.limit || 50, 1), 200);

  // We may need to over-fetch if any filter is applied, since KV
  // doesn't support value-based filtering natively.
  const hasFilter = Boolean(
    options.directive || (options.categories && options.categories.length > 0),
  );
  const fetchLimit = hasFilter ? requestLimit * 3 : requestLimit;

  const listResult = await kv.list({
    prefix: "report:",
    limit: Math.min(fetchLimit, 1000),
    cursor: options.cursor || undefined,
  });

  const categorySet = options.categories && options.categories.length > 0
    ? new Set<string>(options.categories)
    : null;

  const reports: NormalisedReport[] = [];

  for (const key of listResult.keys) {
    if (reports.length >= requestLimit) break;

    const raw = await kv.get<NormalisedReport>(key.name, "json");
    if (!raw) continue;
    const report = backfillReport(raw);

    if (options.directive && report.violatedDirective !== options.directive) {
      continue;
    }
    if (categorySet && !categorySet.has(report.category)) {
      continue;
    }

    reports.push(report);
  }

  return {
    reports,
    cursor: listResult.list_complete ? null : (listResult.cursor || null),
  };
}
