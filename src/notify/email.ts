/**
 * Email notification — send via the configured provider.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env, NormalisedReport } from "../types";
import { getNotifyEmails, getEmailFrom } from "../config";
import { formatPlainText, formatHtml, formatSubject, type NotifyKind } from "./format";
import { createEmailProvider } from "./provider";

/**
 * Send email notifications to all configured recipients.
 */
export async function sendEmails(
  env: Env,
  report: NormalisedReport,
  workerUrl: string,
  kind: NotifyKind = "new",
  recipientsOverride?: string[],
  issueId?: string,
): Promise<void> {
  const recipients = recipientsOverride ?? getNotifyEmails(env);
  const from = getEmailFrom(env);

  if (recipients.length === 0 || !from) {
    if (recipients.length > 0 && !from) {
      console.warn("[email] Recipients configured but EMAIL_FROM is empty — skipping email notifications");
    }
    return;
  }

  const provider = createEmailProvider(env);
  if (!provider) {
    return;
  }

  const subject = formatSubject(report, kind);
  const plainText = formatPlainText(report, workerUrl, kind, issueId);
  const html = formatHtml(report, workerUrl, kind, issueId);

  const results = await Promise.allSettled(
    recipients.map(async (to) => {
      await provider.send({ from, to, subject, text: plainText, html });
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === "rejected") {
      console.error(
        `[email] Failed to send to ${recipients[i]}: ${result.reason}`,
      );
    }
  }
}
