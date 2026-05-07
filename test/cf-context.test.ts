/**
 * Tests for Cloudflare request-context extraction.
 *
 * Critical privacy invariant: extractRequestContext must NEVER read or
 * surface an IP address.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { extractRequestContext } from "../src/cf";

function makeRequest(opts?: {
  cf?: Record<string, unknown>;
  headers?: Record<string, string>;
}): Request {
  const req = new Request("https://csp.example.com/report", {
    headers: opts?.headers,
  });
  if (opts?.cf) {
    Object.defineProperty(req, "cf", { value: opts.cf, configurable: true });
  }
  return req;
}

describe("extractRequestContext", () => {
  it("returns all-null fields when neither cf nor headers are present", () => {
    const ctx = extractRequestContext(makeRequest());
    expect(ctx.country).toBeNull();
    expect(ctx.asn).toBeNull();
    expect(ctx.asOrg).toBeNull();
    expect(ctx.colo).toBeNull();
    expect(ctx.cfRay).toBeNull();
    expect(ctx.httpProtocol).toBeNull();
  });

  it("reads country / asn / asOrg / colo / httpProtocol from request.cf", () => {
    const ctx = extractRequestContext(
      makeRequest({
        cf: {
          country: "DE",
          asn: 15169,
          asOrganization: "Google LLC",
          colo: "FRA",
          httpProtocol: "HTTP/3",
        },
      }),
    );
    expect(ctx.country).toBe("DE");
    expect(ctx.asn).toBe(15169);
    expect(ctx.asOrg).toBe("Google LLC");
    expect(ctx.colo).toBe("FRA");
    expect(ctx.httpProtocol).toBe("HTTP/3");
  });

  it("reads cf-ray from headers", () => {
    const ctx = extractRequestContext(
      makeRequest({ headers: { "cf-ray": "8a1b2c3d4e5f6789-FRA" } }),
    );
    expect(ctx.cfRay).toBe("8a1b2c3d4e5f6789-FRA");
  });

  it("falls back to cf-ipcountry header when cf.country is absent", () => {
    const ctx = extractRequestContext(makeRequest({ headers: { "cf-ipcountry": "JP" } }));
    expect(ctx.country).toBe("JP");
  });

  it("prefers cf.country over cf-ipcountry header when both present", () => {
    const ctx = extractRequestContext(
      makeRequest({ cf: { country: "FR" }, headers: { "cf-ipcountry": "JP" } }),
    );
    expect(ctx.country).toBe("FR");
  });

  it("ignores non-numeric asn values", () => {
    const ctx = extractRequestContext(makeRequest({ cf: { asn: "not-a-number" } }));
    expect(ctx.asn).toBeNull();
  });

  it("PRIVACY: never returns an IP, even if headers contain one", () => {
    const ctx = extractRequestContext(
      makeRequest({
        headers: {
          "cf-connecting-ip": "203.0.113.42",
          "x-forwarded-for": "203.0.113.42, 198.51.100.7",
          "x-real-ip": "203.0.113.42",
        },
      }),
    );

    // Walk every property in the result and assert no field equals the IP.
    const values = Object.values(ctx).map((v) => (v == null ? "" : String(v)));
    for (const v of values) {
      expect(v).not.toContain("203.0.113.42");
      expect(v).not.toContain("198.51.100.7");
    }
  });

  it("PRIVACY: the returned object has a fixed key set with no ip-shaped fields", () => {
    const ctx = extractRequestContext(makeRequest());
    const keys = Object.keys(ctx).sort();
    expect(keys).toEqual(["asOrg", "asn", "cfRay", "colo", "country", "httpProtocol"]);
    // Belt-and-braces: no ip-suggesting key in the result
    for (const k of keys) {
      expect(k.toLowerCase()).not.toMatch(/ip|addr|forward|client/);
    }
  });
});
