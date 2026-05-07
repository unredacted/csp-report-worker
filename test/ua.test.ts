/**
 * Tests for the tiny browser-family parser.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { browserFamily } from "../src/ua";

describe("browserFamily", () => {
  it("returns Other for null or empty", () => {
    expect(browserFamily(null)).toBe("Other");
    expect(browserFamily(undefined)).toBe("Other");
    expect(browserFamily("")).toBe("Other");
  });

  it("classifies bots before Chrome (since most bots include 'Chrome')", () => {
    expect(
      browserFamily(
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/90",
      ),
    ).toBe("Bot");
    expect(browserFamily("python-requests/2.32.0")).toBe("Bot");
    expect(browserFamily("curl/8.0")).toBe("Bot");
  });

  it("classifies Edge before Chrome", () => {
    expect(
      browserFamily(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Edg/120",
      ),
    ).toBe("Edge");
  });

  it("classifies Chrome", () => {
    expect(
      browserFamily(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      ),
    ).toBe("Chrome");
  });

  it("classifies Firefox", () => {
    expect(browserFamily("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0")).toBe(
      "Firefox",
    );
  });

  it("classifies Safari (no Chrome)", () => {
    expect(
      browserFamily(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1 Version/17 Safari/605.1",
      ),
    ).toBe("Safari");
  });

  it("classifies Opera", () => {
    expect(browserFamily("Mozilla/5.0 ... OPR/110.0")).toBe("Opera");
  });
});
