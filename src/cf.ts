/**
 * Cloudflare request-context extraction — no IP.
 *
 * Reads from the documented `request.cf` properties and CF response headers.
 * NEVER reads cf-connecting-ip, x-forwarded-for, or any IP-bearing field.
 * If you need IP capture for forensics, that should be a deliberate, opt-in,
 * documented schema change — don't add it here.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface RequestContext {
  /** ISO 3166-1 alpha-2 country code, or null. */
  country: string | null;
  /** Autonomous System Number, or null. */
  asn: number | null;
  /** Human-readable AS name (e.g. "Google LLC"), or null. */
  asOrg: string | null;
  /** Cloudflare datacenter colo (3-letter IATA-like), or null. */
  colo: string | null;
  /** CF-Ray request id, or null. */
  cfRay: string | null;
  /** "HTTP/2", "HTTP/3", etc., or null. */
  httpProtocol: string | null;
}

interface CfProps {
  country?: string;
  asn?: number;
  asOrganization?: string;
  colo?: string;
  httpProtocol?: string;
}

/**
 * Extract Cloudflare context from a Request. Falls back to nulls when fields
 * are absent (local dev, miniflare without IPs, non-CF runtimes).
 */
export function extractRequestContext(request: Request): RequestContext {
  const cf = (request as unknown as { cf?: CfProps }).cf;
  return {
    country: cf?.country ?? request.headers.get("cf-ipcountry") ?? null,
    asn: typeof cf?.asn === "number" ? cf.asn : null,
    asOrg: cf?.asOrganization ?? null,
    colo: cf?.colo ?? null,
    cfRay: request.headers.get("cf-ray"),
    httpProtocol: cf?.httpProtocol ?? null,
  };
}
