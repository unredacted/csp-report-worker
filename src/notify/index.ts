/**
 * Notification orchestrator — dispatches email + webhook notifications.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env, NormalisedReport } from "../types";
import { getNotifyWebhooks } from "../config";
import { sendWebhooks } from "./webhook";
import { sendEmails } from "./email";

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
