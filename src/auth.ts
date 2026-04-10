/**
 * Authentication — Bearer token check for API endpoints.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env } from "./types";

/**
 * Validate the Authorization header against env.API_TOKEN.
 *
 * @returns A 401/403 Response if auth fails, or null if auth succeeds.
 */
export function requireAuth(request: Request, env: Env): Response | null {
  if (!env.API_TOKEN) {
    return new Response(
      JSON.stringify({ error: "API_TOKEN not configured — API access disabled" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Missing Authorization header" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
    return new Response(
      JSON.stringify({ error: "Expected Bearer token" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const token = parts[1] || "";

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(token, env.API_TOKEN)) {
    return new Response(
      JSON.stringify({ error: "Invalid token" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return null; // Auth passed
}

/**
 * Constant-time string comparison.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid length-leaking short-circuit
    // (though length difference itself is observable).
    const encoder = new TextEncoder();
    const aBuf = encoder.encode(a);
    const bBuf = encoder.encode(a); // Compare a with itself to burn time
    crypto.subtle.timingSafeEqual(aBuf, bBuf);
    return false;
  }

  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  return crypto.subtle.timingSafeEqual(aBuf, bBuf);
}
