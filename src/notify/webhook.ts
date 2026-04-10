/**
 * Webhook notification — generic HTTP POST to configured URLs.
 *
 * Fire-and-forget with a 5-second timeout. Failed deliveries are
 * logged but not retried — CSP reports are high-volume and losing
 * an occasional notification is acceptable.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NormalisedReport } from "../types";
import { formatWebhookPayload } from "./format";

/**
 * POST notification payloads to all configured webhook URLs.
 */
export async function sendWebhooks(
  webhookUrls: string[],
  report: NormalisedReport,
  workerUrl: string,
): Promise<void> {
  if (webhookUrls.length === 0) return;

  const payload = formatWebhookPayload(report, workerUrl);
  const body = JSON.stringify(payload);

  const results = await Promise.allSettled(
    webhookUrls.map((url) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(5000),
      }),
    ),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === "rejected") {
      console.error(
        `[webhook] Failed to deliver to ${webhookUrls[i]}: ${result.reason}`,
      );
    } else if (!result.value.ok) {
      console.error(
        `[webhook] Non-OK response from ${webhookUrls[i]}: ${result.value.status} ${result.value.statusText}`,
      );
    }
  }
}
