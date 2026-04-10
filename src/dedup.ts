/**
 * Deduplication — fingerprint computation and KV dedup window management.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NormalisedReport, DedupEntry } from "./types";

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

/**
 * Check whether a fingerprint has been seen within the dedup window.
 *
 * @returns `true` if this is a new (unseen) fingerprint — notification should fire.
 *          `false` if it's a duplicate — notification should be suppressed.
 */
export async function isDuplicate(
  kv: KVNamespace,
  fingerprint: string,
): Promise<boolean> {
  const key = `dedup:${fingerprint}`;
  const existing = await kv.get<DedupEntry>(key, "json");
  return existing !== null;
}

/**
 * Record a dedup entry. If one already exists, increment its count.
 * If it's new, create it.
 *
 * @param windowMinutes - TTL for the dedup key in minutes.
 */
export async function recordDedup(
  kv: KVNamespace,
  fingerprint: string,
  windowMinutes: number,
): Promise<void> {
  const key = `dedup:${fingerprint}`;
  const ttlSeconds = windowMinutes * 60;

  const existing = await kv.get<DedupEntry>(key, "json");

  if (existing) {
    // Increment count, preserve firstSeen, refresh TTL
    const updated: DedupEntry = {
      count: existing.count + 1,
      firstSeen: existing.firstSeen,
    };
    await kv.put(key, JSON.stringify(updated), { expirationTtl: ttlSeconds });
  } else {
    // First occurrence
    const entry: DedupEntry = {
      count: 1,
      firstSeen: new Date().toISOString(),
    };
    await kv.put(key, JSON.stringify(entry), { expirationTtl: ttlSeconds });
  }
}
