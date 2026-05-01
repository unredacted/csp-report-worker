/**
 * Notification orchestrator — dispatches email + webhook notifications.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env, NormalisedReport } from "../types";
import { getMutedCategories, getNotifyWebhooks } from "../config";
import { sendWebhooks } from "./webhook";
import { sendEmails } from "./email";

/**
 * Decide whether a CSP report should fire email/webhook notifications.
 *
 * Reports whose `category` is in the configured mute set are still stored
 * in KV and counted in dedup state, but they do not page operators. This
 * keeps the report log complete for forensic review while keeping inboxes
 * focused on signals worth reading.
 *
 * Categorisation considers both `blockedUri` and `sourceFile`, so a violation
 * triggered by an extension-injected script that targets a legitimate-looking
 * external host is still correctly identified as an extension report and muted.
 */
export function shouldNotify(env: Env, report: NormalisedReport): boolean {
  const muted = getMutedCategories(env);
  if (muted.length === 0) return true;
  return !muted.includes(report.category);
}

/**
 * Dispatch all configured notifications for a new CSP violation.
 *
 * Catches and logs all errors — caller should not need to handle failures.
 * This function is intended to be called via ctx.waitUntil().
 */
export async function dispatchNotifications(
  env: Env,
  report: NormalisedReport,
  workerUrl: string,
): Promise<void> {
  const webhookUrls = getNotifyWebhooks(env);

  try {
    await Promise.allSettled([
      sendWebhooks(webhookUrls, report, workerUrl),
      sendEmails(env, report, workerUrl),
    ]);
  } catch (err) {
    console.error("[notify] Unexpected error dispatching notifications:", err);
  }
}
