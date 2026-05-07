/**
 * Scheduled maintenance — invoked by Cloudflare Cron Triggers via the
 * `scheduled` Worker handler.
 *
 *   - Retention sweep: delete issues older than RETENTION_DAYS (default 90).
 *     Cascades to issue_events + issue_status_log via FK ON DELETE CASCADE.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env } from "./types";
import { getRetentionDays } from "./config";

export interface RetentionResult {
  deletedIssues: number;
  cutoff: string | null;
}

/**
 * Delete issues whose last_seen is older than the retention cutoff.
 * Returns how many issues were deleted, or zero with cutoff=null when
 * retention is disabled.
 */
export async function runRetentionSweep(
  db: D1Database,
  env: Env,
): Promise<RetentionResult> {
  const days = getRetentionDays(env);
  if (days <= 0) return { deletedIssues: 0, cutoff: null };

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // D1 doesn't expose changes() directly on .run(); use a count + delete pair.
  const before = await db
    .prepare("SELECT COUNT(*) AS n FROM issues WHERE last_seen < ?")
    .bind(cutoff)
    .first<{ n: number }>();
  const deletedIssues = before?.n ?? 0;
  if (deletedIssues > 0) {
    await db.prepare("DELETE FROM issues WHERE last_seen < ?").bind(cutoff).run();
  }
  return { deletedIssues, cutoff };
}
