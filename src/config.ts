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
export type EmailProviderType = "cloudflare" | "mailgun" | "ses" | "resend";

/** Active email provider, or null if email is disabled. */
export function getEmailProvider(env: Env): EmailProviderType | null {
  const val = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!val) return null;
  const valid: EmailProviderType[] = ["cloudflare", "mailgun", "ses", "resend"];
  if (valid.includes(val as EmailProviderType)) return val as EmailProviderType;
  console.warn(`[config] Unknown EMAIL_PROVIDER "${val}" — email disabled`);
  return null;
}

/**
 * Default `blockedUri` prefixes treated as noise and dropped at ingestion.
 * These are universally non-actionable: browser extensions and browser-internal
 * resources have no security signal value and only inflate KV writes and
 * notification volume.
 *
 * Notable exclusions: `data:`, `blob:`, `inline`, and `eval` are kept because
 * they carry real XSS-related signal.
 */
export const DEFAULT_NOISE_URI_PREFIXES: readonly string[] = [
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
  "safari-extension://",
  "webkit-masked-url://",
  "chrome://",
  "about:",
];

/**
 * Resolve the list of `blockedUri` prefixes that should be dropped at ingestion.
 *
 * - Unset/empty: use `DEFAULT_NOISE_URI_PREFIXES`.
 * - `"none"` (case-insensitive): empty list — disables filtering entirely.
 * - Comma-separated string: explicit list, replaces the default.
 */
export function getIgnoredBlockedUriPrefixes(env: Env): readonly string[] {
  const raw = env.IGNORE_BLOCKED_URI_PREFIXES?.trim();
  if (!raw) return DEFAULT_NOISE_URI_PREFIXES;
  if (raw.toLowerCase() === "none") return [];
  return raw.split(",").map((p) => p.trim()).filter(Boolean);
}

/** Maximum request body size in bytes (64 KB). */
export const MAX_BODY_SIZE = 65_536;

/** Inverted-timestamp ceiling for KV key ordering (year ~2286). */
export const INVERTED_TS_CEILING = 9_999_999_999_999;

/**
 * Dynamically locate the KV namespace binding.
 * This avoids hardcoding "CSP_REPORTS" and scans the environment for
 * the first property that implements the KVNamespace interface.
 */
export function getKvNamespace(env: Env): KVNamespace {
  for (const key of Object.keys(env)) {
    const val = env[key] as any;
    if (
      val &&
      typeof val === "object" &&
      typeof val.put === "function" &&
      typeof val.get === "function" &&
      typeof val.list === "function"
    ) {
      return val as KVNamespace;
    }
  }
  throw new Error("No KV namespace binding found in the environment.");
}
