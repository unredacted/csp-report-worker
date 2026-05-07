/**
 * Tests for per-property notification overrides — the property's
 * notify_emails, notify_webhooks, and mute_categories fields take
 * precedence over the global env vars when set.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { notifyKindForTransition } from "../src/notify/index";
import type { Env, Property, ReportCategory } from "../src/types";

function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...(env as unknown as Env), ...overrides };
}

function makeProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: "p1",
    slug: "p1",
    name: "P1",
    ingestToken: "tok",
    notifyEmails: null,
    notifyWebhooks: null,
    muteCategories: null,
    createdAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
    ...overrides,
  };
}

describe("notifyKindForTransition with property override", () => {
  it("uses the property's mute_categories when set, ignoring env defaults", () => {
    const e = testEnv(); // env defaults mute extension + browser-internal
    const property = makeProperty({ muteCategories: "external" });

    // Property overrides — extension is no longer muted
    expect(
      notifyKindForTransition(e, "created", "extension" as ReportCategory, property),
    ).toBe("new");
    // External IS muted by the property's override
    expect(
      notifyKindForTransition(e, "created", "external" as ReportCategory, property),
    ).toBeNull();
  });

  it("falls back to env defaults when the property's mute_categories is null", () => {
    const e = testEnv();
    const property = makeProperty({ muteCategories: null });

    // Env defaults still mute extension
    expect(
      notifyKindForTransition(e, "created", "extension" as ReportCategory, property),
    ).toBeNull();
  });

  it("respects 'none' on the property to disable muting entirely", () => {
    const e = testEnv();
    const property = makeProperty({ muteCategories: "none" });

    expect(
      notifyKindForTransition(e, "created", "extension" as ReportCategory, property),
    ).toBe("new");
    expect(
      notifyKindForTransition(e, "created", "browser-internal" as ReportCategory, property),
    ).toBe("new");
  });

  it("treats an empty string as 'use env defaults'", () => {
    const e = testEnv();
    const property = makeProperty({ muteCategories: "" });

    // Empty string falls back to global env mute set
    expect(
      notifyKindForTransition(e, "created", "extension" as ReportCategory, property),
    ).toBeNull();
  });

  it("noop transitions never notify even with permissive overrides", () => {
    const e = testEnv();
    const property = makeProperty({ muteCategories: "none" });
    expect(
      notifyKindForTransition(e, "noop", "extension" as ReportCategory, property),
    ).toBeNull();
  });
});
