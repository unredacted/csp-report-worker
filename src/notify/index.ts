/**
 * Notification orchestrator — gates and dispatches email + webhook
 * notifications based on issue lifecycle transitions.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env, NormalisedReport, Property, ReportCategory } from "../types";
import type { IssueTransition } from "../issues";
import { getMutedCategories, getNotifyEmails, getNotifyWebhooks } from "../config";
import { sendWebhooks } from "./webhook";
import { sendEmails } from "./email";

export type NotifyKind = "new" | "resurrection";

function csvToList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resolve effective mute set: per-property override (if set) replaces the global env list. */
function resolveMutedCategories(env: Env, property?: Property | null): readonly string[] {
  if (property?.muteCategories != null) {
    const raw = property.muteCategories.trim();
    if (raw.toLowerCase() === "none") return [];
    return raw ? csvToList(raw) : getMutedCategories(env);
  }
  return getMutedCategories(env);
}

/** Resolve effective email recipients: per-property override (if set) replaces global. */
function resolveEmails(env: Env, property?: Property | null): string[] {
  if (property?.notifyEmails != null) return csvToList(property.notifyEmails);
  return getNotifyEmails(env);
}

/** Resolve effective webhook URLs: per-property override (if set) replaces global. */
function resolveWebhooks(env: Env, property?: Property | null): string[] {
  if (property?.notifyWebhooks != null) return csvToList(property.notifyWebhooks);
  return getNotifyWebhooks(env);
}

/**
 * Translate an issue transition to a notification kind, or null if the
 * transition shouldn't fire one. Mute-by-category still applies, with
 * per-property override taking precedence over the global env list.
 */
export function notifyKindForTransition(
  env: Env,
  transition: IssueTransition,
  category: ReportCategory,
  property?: Property | null,
): NotifyKind | null {
  if (transition !== "created" && transition !== "resurrected") return null;
  const muted = resolveMutedCategories(env, property);
  if (muted.includes(category)) return null;
  return transition === "created" ? "new" : "resurrection";
}

/**
 * Dispatch all configured notifications for an issue transition.
 *
 * Per-property overrides for email recipients and webhook URLs take
 * precedence over the global env vars. If a property explicitly sets an
 * empty CSV (`notify_emails = ""`), that property has no recipients —
 * useful for "store-only" properties.
 *
 * Catches and logs all errors — caller should not need to handle failures.
 * This function is intended to be called via ctx.waitUntil().
 */
export async function dispatchNotifications(
  env: Env,
  report: NormalisedReport,
  workerUrl: string,
  kind: NotifyKind = "new",
  property?: Property | null,
  issueId?: string,
): Promise<void> {
  const webhookUrls = resolveWebhooks(env, property);
  const emailRecipients = resolveEmails(env, property);

  try {
    await Promise.allSettled([
      sendWebhooks(webhookUrls, report, workerUrl, kind, issueId),
      sendEmails(env, report, workerUrl, kind, emailRecipients, issueId),
    ]);
  } catch (err) {
    console.error("[notify] Unexpected error dispatching notifications:", err);
  }
}
