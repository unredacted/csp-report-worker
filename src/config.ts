/**
 * Configuration helpers — parse environment variables with defaults.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env } from "./types";

/** Minutes to suppress duplicate fingerprints (default: 60). */
export function getDedupWindowMinutes(env: Env): number {
  const val = parseInt(env.DEDUP_WINDOW_MINUTES, 10);
  return Number.isFinite(val) && val > 0 ? val : 60;
}

/** TTL in seconds for stored reports (default: 604800 = 7 days). */
export function getKvTtlSeconds(env: Env): number {
  const val = parseInt(env.KV_TTL_SECONDS, 10);
  return Number.isFinite(val) && val > 0 ? val : 604_800;
}

/** Allowed origins list, or null if unrestricted. */
export function getAllowedOrigins(env: Env): string[] | null {
  const raw = env.ALLOWED_ORIGINS?.trim();
  if (!raw) return null;
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

/** Email recipient addresses. */
export function getNotifyEmails(env: Env): string[] {
  const raw = env.NOTIFY_EMAILS?.trim();
  if (!raw) return [];
  return raw.split(",").map((e) => e.trim()).filter(Boolean);
}

/** Webhook URLs to POST to. */
export function getNotifyWebhooks(env: Env): string[] {
  const raw = env.NOTIFY_WEBHOOKS?.trim();
  if (!raw) return [];
  return raw.split(",").map((u) => u.trim()).filter(Boolean);
}

/** Email "from" address. */
export function getEmailFrom(env: Env): string {
  return env.EMAIL_FROM?.trim() || "";
}

/** Supported email provider backends. */
export type EmailProviderType =
  | "cloudflare-email"
  | "cloudflare-routing"
  | "mailgun"
  | "ses"
  | "resend";

/** Active email provider, or null if email is disabled. */
export function getEmailProvider(env: Env): EmailProviderType | null {
  const val = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!val) return null;
  const valid: EmailProviderType[] = [
    "cloudflare-email",
    "cloudflare-routing",
    "mailgun",
    "ses",
    "resend",
  ];
  if (valid.includes(val as EmailProviderType)) return val as EmailProviderType;
  console.warn(`[config] Unknown EMAIL_PROVIDER "${val}" — email disabled`);
  return null;
}

/**
 * Default report categories whose reports are stored but do NOT trigger
 * email/webhook notifications. Browser-extension and browser-internal
 * sources have no security signal under typical attacker models, but the
 * reports themselves remain useful as a passive monitoring log and stay
 * queryable via the API.
 *
 * Notable exclusions: `inline`, `eval`, `data`, `blob`, `same-origin`, and
 * `external` are NOT in the default mute list — each can carry real signal.
 */
export const DEFAULT_MUTED_CATEGORIES: readonly string[] = [
  "extension",
  "browser-internal",
];

/**
 * Resolve the list of categories whose reports should be muted (stored,
 * but not notified about).
 *
 * - Unset/empty: use `DEFAULT_MUTED_CATEGORIES`.
 * - `"none"` (case-insensitive): empty list — every report fires notifications.
 * - Comma-separated string: explicit list, replaces the default.
 */
export function getMutedCategories(env: Env): readonly string[] {
  const raw = env.MUTE_CATEGORIES?.trim();
  if (!raw) return DEFAULT_MUTED_CATEGORIES;
  if (raw.toLowerCase() === "none") return [];
  return raw.split(",").map((p) => p.trim()).filter(Boolean);
}

/** Maximum request body size in bytes (64 KB). */
export const MAX_BODY_SIZE = 65_536;

/** Inverted-timestamp ceiling for KV key ordering (year ~2286). */
export const INVERTED_TS_CEILING = 9_999_999_999_999;

/**
 * Dynamically locate the KV namespace binding.
 * Avoids hardcoding the binding name. Matches by constructor name because
 * JSRPC service-binding stubs (e.g. ASSETS) expose `.get`/`.put`/`.list`
 * as call-anything stubs, so a duck-typed shape check would pick those up.
 */
export function getKvNamespace(env: Env): KVNamespace {
  for (const key of Object.keys(env)) {
    const val = env[key] as any;
    if (val?.constructor?.name === "KvNamespace") {
      return val as KVNamespace;
    }
  }
  throw new Error("No KV namespace binding found in the environment.");
}
