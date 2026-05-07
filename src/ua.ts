/**
 * Tiny User-Agent → browser family classifier.
 *
 * Deliberately coarse — we want quick triage signal ("which browsers
 * are firing this issue?") not full UA parsing. If we ever need real
 * accuracy, swap in ua-parser-js or similar.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type BrowserFamily =
  | "Chrome"
  | "Firefox"
  | "Safari"
  | "Edge"
  | "Opera"
  | "Bot"
  | "Other";

export function browserFamily(ua: string | null | undefined): BrowserFamily {
  if (!ua) return "Other";
  // Bots first — many include "Chrome" in their UA.
  if (/bot|crawler|spider|slurp|curl|wget|python-requests/i.test(ua)) return "Bot";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}
