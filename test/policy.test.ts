/**
 * Tests for the CSP policy assistant — suggestPolicyFromIssues + renderPolicy.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import {
  renderPolicy,
  suggestPolicyFromIssues,
  type PolicySelection,
} from "../src/policy";
import type { ReportCategory } from "../src/classify";

interface RowOverride {
  id?: string;
  category?: ReportCategory;
  effective_directive?: string;
  violated_directive?: string;
  blocked_uri?: string;
  event_count?: number;
}

function row(o: RowOverride = {}) {
  return {
    id: o.id ?? "default:abc",
    category: o.category ?? "external",
    effective_directive: o.effective_directive ?? "script-src",
    violated_directive: o.violated_directive ?? "script-src",
    blocked_uri: o.blocked_uri ?? "https://cdn.partner.com/widget.js",
    event_count: o.event_count ?? 1,
  };
}

describe("suggestPolicyFromIssues", () => {
  it("returns empty groups for no issues", () => {
    expect(suggestPolicyFromIssues([])).toEqual({ groups: [] });
  });

  it("suggests origin host for external category", () => {
    const result = suggestPolicyFromIssues([row()]);
    expect(result.groups.length).toBe(1);
    expect(result.groups[0]!.directive).toBe("script-src");
    expect(result.groups[0]!.tokens.length).toBe(1);
    expect(result.groups[0]!.tokens[0]!.value).toBe("https://cdn.partner.com");
    expect(result.groups[0]!.tokens[0]!.riskWarning).toBe(false);
  });

  it("dedupes identical hosts and sums event counts", () => {
    const result = suggestPolicyFromIssues([
      row({ id: "a", event_count: 5 }),
      row({ id: "b", event_count: 3, blocked_uri: "https://cdn.partner.com/other.js" }),
    ]);
    const tokens = result.groups[0]!.tokens;
    expect(tokens.length).toBe(1);
    expect(tokens[0]!.value).toBe("https://cdn.partner.com");
    expect(tokens[0]!.issueCount).toBe(2);
    expect(tokens[0]!.eventCount).toBe(8);
    expect(tokens[0]!.issueIds.sort()).toEqual(["a", "b"]);
  });

  it("ranks tokens within a directive by event count DESC", () => {
    const result = suggestPolicyFromIssues([
      row({ id: "a", event_count: 5, blocked_uri: "https://low.example/x.js" }),
      row({ id: "b", event_count: 50, blocked_uri: "https://high.example/x.js" }),
      row({ id: "c", event_count: 25, blocked_uri: "https://mid.example/x.js" }),
    ]);
    const tokens = result.groups[0]!.tokens;
    expect(tokens.map((t) => t.value)).toEqual([
      "https://high.example",
      "https://mid.example",
      "https://low.example",
    ]);
  });

  it("groups separately by directive", () => {
    const result = suggestPolicyFromIssues([
      row({ effective_directive: "script-src" }),
      row({ effective_directive: "style-src", blocked_uri: "https://fonts.example/style.css" }),
      row({ effective_directive: "img-src", blocked_uri: "https://images.example/p.png" }),
    ]);
    const dirs = result.groups.map((g) => g.directive).sort();
    expect(dirs).toEqual(["img-src", "script-src", "style-src"]);
  });

  it("strips '<directive> <token>' to just the directive name", () => {
    const result = suggestPolicyFromIssues([
      row({ effective_directive: "script-src 'self'" }),
    ]);
    expect(result.groups[0]!.directive).toBe("script-src");
  });

  it("emits 'unsafe-inline' with riskWarning for inline category", () => {
    const result = suggestPolicyFromIssues([row({ category: "inline" })]);
    expect(result.groups[0]!.tokens[0]!.value).toBe("'unsafe-inline'");
    expect(result.groups[0]!.tokens[0]!.riskWarning).toBe(true);
  });

  it("emits 'unsafe-eval' with riskWarning for eval category", () => {
    const result = suggestPolicyFromIssues([row({ category: "eval" })]);
    expect(result.groups[0]!.tokens[0]!.value).toBe("'unsafe-eval'");
    expect(result.groups[0]!.tokens[0]!.riskWarning).toBe(true);
  });

  it("emits 'data:' for data category", () => {
    const result = suggestPolicyFromIssues([
      row({ category: "data", blocked_uri: "data:image/png;base64,iVBOR..." }),
    ]);
    expect(result.groups[0]!.tokens[0]!.value).toBe("data:");
  });

  it("emits 'blob:' for blob category", () => {
    const result = suggestPolicyFromIssues([
      row({ category: "blob", blocked_uri: "blob:https://example.com/abc-123" }),
    ]);
    expect(result.groups[0]!.tokens[0]!.value).toBe("blob:");
  });

  it("never suggests for extension or browser-internal", () => {
    const result = suggestPolicyFromIssues([
      row({ category: "extension", blocked_uri: "chrome-extension://abc/x.js" }),
      row({ category: "browser-internal", blocked_uri: "chrome://settings/x.js" }),
    ]);
    expect(result.groups).toEqual([]);
  });

  it("never suggests for same-origin or unknown", () => {
    const result = suggestPolicyFromIssues([
      row({ category: "same-origin" }),
      row({ category: "unknown" }),
    ]);
    expect(result.groups).toEqual([]);
  });

  it("preserves port in origin extraction", () => {
    const result = suggestPolicyFromIssues([
      row({ blocked_uri: "https://cdn.x.com:8443/widget.js" }),
    ]);
    expect(result.groups[0]!.tokens[0]!.value).toBe("https://cdn.x.com:8443");
  });

  it("falls back to violated_directive when effective_directive is empty", () => {
    const result = suggestPolicyFromIssues([
      row({ effective_directive: "", violated_directive: "img-src" }),
    ]);
    expect(result.groups[0]!.directive).toBe("img-src");
  });

  it("skips issues with un-parseable blocked_uri for external category", () => {
    const result = suggestPolicyFromIssues([
      row({ blocked_uri: "not-a-url" }),
    ]);
    expect(result.groups).toEqual([]);
  });
});

describe("renderPolicy", () => {
  it("returns the baseline unchanged when selections are empty", () => {
    const baseline = "default-src 'self'; script-src 'self'";
    expect(renderPolicy(baseline, [])).toBe("default-src 'self'; script-src 'self'");
  });

  it("adds a token to an existing directive", () => {
    const result = renderPolicy("script-src 'self'", [
      { directive: "script-src", value: "https://cdn.partner.com" },
    ]);
    expect(result).toBe("script-src 'self' https://cdn.partner.com");
  });

  it("creates a new directive when not present in baseline", () => {
    const result = renderPolicy("default-src 'self'", [
      { directive: "img-src", value: "https://images.example" },
    ]);
    expect(result).toBe("default-src 'self'; img-src https://images.example");
  });

  it("dedupes when the token is already present", () => {
    const result = renderPolicy("script-src 'self' https://cdn.x.com", [
      { directive: "script-src", value: "https://cdn.x.com" },
    ]);
    expect(result).toBe("script-src 'self' https://cdn.x.com");
  });

  it("preserves directive ordering from the baseline", () => {
    const baseline = "default-src 'self'; img-src 'self'; script-src 'self'";
    const result = renderPolicy(baseline, [
      { directive: "script-src", value: "https://a.example" },
      { directive: "img-src", value: "https://b.example" },
    ]);
    expect(result).toBe(
      "default-src 'self'; img-src 'self' https://b.example; script-src 'self' https://a.example",
    );
  });

  it("appends multiple selections for the same directive", () => {
    const result = renderPolicy("script-src 'self'", [
      { directive: "script-src", value: "https://a.example" },
      { directive: "script-src", value: "https://b.example" },
    ]);
    expect(result).toBe("script-src 'self' https://a.example https://b.example");
  });

  it("handles an empty baseline", () => {
    const result = renderPolicy("", [
      { directive: "script-src", value: "'self'" },
      { directive: "img-src", value: "data:" },
    ]);
    expect(result).toBe("script-src 'self'; img-src data:");
  });

  it("merges duplicate directive entries from baseline", () => {
    // Some pages report a baseline with duplicated directive declarations.
    const result = renderPolicy("script-src 'self'; script-src https://x.example", [
      { directive: "script-src", value: "https://y.example" },
    ]);
    // Order-preservation: first occurrence wins for position; sources merged.
    expect(result).toBe("script-src 'self' https://x.example https://y.example");
  });

  it("supports adding 'unsafe-inline' (verbatim)", () => {
    const result = renderPolicy("script-src 'self'", [
      { directive: "script-src", value: "'unsafe-inline'" },
    ]);
    expect(result).toBe("script-src 'self' 'unsafe-inline'");
  });

  it("supports adding scheme tokens like data: and blob:", () => {
    const result = renderPolicy("img-src 'self'", [
      { directive: "img-src", value: "data:" },
      { directive: "img-src", value: "blob:" },
    ]);
    expect(result).toBe("img-src 'self' data: blob:");
  });
});

describe("PolicySelection contract", () => {
  it("PolicySelection { directive, value } is the wire shape", () => {
    const sel: PolicySelection = { directive: "script-src", value: "https://x.example" };
    expect(sel).toMatchObject({ directive: "script-src", value: "https://x.example" });
  });
});
