/**
 * Tests for the notification gate (notifyKindForTransition).
 *
 * In M3 this replaced the old `shouldNotify` gate: notifications now fire
 * only on issue lifecycle transitions (`created`, `resurrected`), and the
 * category mute set further filters which transitions actually page.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { notifyKindForTransition } from "../src/notify/index";
import type { Env, ReportCategory } from "../src/types";
import type { IssueTransition } from "../src/issues";

function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ...overrides } as Env;
}

describe("notifyKindForTransition", () => {
  describe("transition gate", () => {
    it("returns 'new' on `created`", () => {
      expect(notifyKindForTransition(testEnv(), "created", "external")).toBe("new");
    });
    it("returns 'resurrection' on `resurrected`", () => {
      expect(notifyKindForTransition(testEnv(), "resurrected", "external")).toBe(
        "resurrection",
      );
    });
    it("returns null on `noop`", () => {
      expect(notifyKindForTransition(testEnv(), "noop", "external")).toBeNull();
    });
  });

  describe("default mute set", () => {
    it.each([["extension"], ["browser-internal"]] as const)(
      "mutes %s even on a `created` transition",
      (cat) => {
        expect(
          notifyKindForTransition(testEnv(), "created", cat as ReportCategory),
        ).toBeNull();
      },
    );

    it.each([
      ["external"],
      ["same-origin"],
      ["inline"],
      ["data"],
      ["blob"],
      ["eval"],
      ["unknown"],
    ] as const)("does NOT mute %s by default", (cat) => {
      expect(
        notifyKindForTransition(testEnv(), "created", cat as ReportCategory),
      ).toBe("new");
    });
  });

  describe("MUTE_CATEGORIES env override", () => {
    it("replaces the default list when set", () => {
      const overrideEnv = testEnv({ MUTE_CATEGORIES: "external" });
      expect(notifyKindForTransition(overrideEnv, "created", "extension")).toBe("new");
      expect(notifyKindForTransition(overrideEnv, "created", "external")).toBeNull();
    });

    it("'none' (case-insensitive) disables muting", () => {
      const lower = testEnv({ MUTE_CATEGORIES: "none" });
      const upper = testEnv({ MUTE_CATEGORIES: "NONE" });
      expect(notifyKindForTransition(lower, "created", "extension")).toBe("new");
      expect(notifyKindForTransition(upper, "created", "extension")).toBe("new");
    });

    it("falls back to defaults when unset, empty, or whitespace", () => {
      const cases: (Env["MUTE_CATEGORIES"])[] = [undefined, "", "   "];
      for (const v of cases) {
        expect(
          notifyKindForTransition(testEnv({ MUTE_CATEGORIES: v }), "created", "extension"),
        ).toBeNull();
      }
    });

    it("accepts a comma-separated list of multiple categories", () => {
      const e = testEnv({ MUTE_CATEGORIES: "extension,external" });
      expect(notifyKindForTransition(e, "created", "extension")).toBeNull();
      expect(notifyKindForTransition(e, "created", "external")).toBeNull();
      expect(notifyKindForTransition(e, "created", "inline")).toBe("new");
    });

    it("mutes resurrection transitions the same way as new ones", () => {
      const e = testEnv({ MUTE_CATEGORIES: "external" });
      expect(notifyKindForTransition(e, "resurrected", "external")).toBeNull();
      expect(notifyKindForTransition(e, "resurrected", "inline")).toBe("resurrection");
    });
  });
});

// Suppress unused-import warning when IssueTransition is implied by string literal.
const _exhaustive: IssueTransition[] = ["created", "resurrected", "noop"];
void _exhaustive;
