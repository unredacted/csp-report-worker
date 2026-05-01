/**
 * Notification orchestrator — dispatches email + webhook notifications.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env, NormalisedReport } from "../types";
import { getMutedBlockedUriPrefixes, getNotifyWebhooks } from "../config";
import { sendWebhooks } from "./webhook";
import { sendEmails } from "./email";

/**
 * Decide whether a CSP report should fire email/webhook notifications.
 *
 * Reports whose `blockedUri` matches the configured mute prefixes are still
 * stored in KV and counted in dedup state, but they do not page operators.
 * This keeps the report log complete for forensic review while keeping
 * inboxes focused on signals worth reading.
 */
export function shouldNotify(env: Env, report: NormalisedReport): boolean {
  const prefixes = getMutedBlockedUriPrefixes(env);
  if (prefixes.length === 0) return true;
  if (!report.blockedUri) return true;
  return !prefixes.some((p) => report.blockedUri.startsWith(p));
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
