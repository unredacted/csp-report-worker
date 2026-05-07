/**
 * Tests for the property model — bootstrap, slug routing, admin CRUD,
 * BOOTSTRAP_PROPERTIES seeding.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { runMigrations, _resetMigrationCache } from "../src/db";
import {
  archiveProperty,
  createProperty,
  ensureDefaultProperty,
  ensureSeeded,
  getPropertyById,
  getPropertyBySlug,
  InvalidSlugError,
  listProperties,
  resolvePropertyForRequest,
  rotateIngestToken,
  SlugTakenError,
  updateProperty,
  validateSlug,
  _resetSeedCache,
} from "../src/properties";
import type { Env, Property } from "../src/types";

const getDb = (): D1Database => (env as unknown as Env).DB!;

async function freshDb(overrides: Partial<Env> = {}): Promise<Env> {
  for (const t of ["issue_status_log", "issue_events", "issues", "properties", "_migrations"]) {
    await getDb().prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }
  _resetMigrationCache();
  _resetSeedCache();
  await runMigrations(getDb());
  return { ...(env as unknown as Env), ...overrides };
}

describe("ensureDefaultProperty", () => {
  beforeEach(() => freshDb());

  it("creates the default property when none exists", async () => {
    const p = await ensureDefaultProperty(getDb());
    expect(p.id).toBe("default");
    expect(p.slug).toBe("default");
    expect(p.ingestToken).toBe("");
  });

  it("returns the existing default property on subsequent calls", async () => {
    const a = await ensureDefaultProperty(getDb());
    const b = await ensureDefaultProperty(getDb());
    expect(b.createdAt).toBe(a.createdAt);

    const count = await getDb()
      .prepare("SELECT COUNT(*) AS n FROM properties")
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

describe("getPropertyBySlug / getPropertyById", () => {
  beforeEach(() => freshDb());

  it("looks up by slug, then by id", async () => {
    await ensureDefaultProperty(getDb());
    expect((await getPropertyBySlug(getDb(), "default"))?.id).toBe("default");
    expect((await getPropertyById(getDb(), "default"))?.slug).toBe("default");
  });

  it("returns null for unknown slug", async () => {
    await ensureDefaultProperty(getDb());
    expect(await getPropertyBySlug(getDb(), "nope")).toBeNull();
  });

  it("does not return archived properties via slug lookup", async () => {
    await ensureDefaultProperty(getDb());
    const now = new Date().toISOString();
    await getDb()
      .prepare(
        "INSERT INTO properties (id, slug, name, ingest_token, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("archived-id", "archived-slug", "Archived", "tok", now, now)
      .run();
    expect(await getPropertyBySlug(getDb(), "archived-slug")).toBeNull();
    expect((await getPropertyById(getDb(), "archived-id"))?.archivedAt).not.toBeNull();
  });
});

describe("validateSlug", () => {
  it("accepts valid slugs", () => {
    expect(() => validateSlug("default")).not.toThrow();
    expect(() => validateSlug("marketing-site")).not.toThrow();
    expect(() => validateSlug("a")).not.toThrow();
    expect(() => validateSlug("a1")).not.toThrow();
    expect(() => validateSlug("123")).not.toThrow();
  });

  it("rejects invalid slugs", () => {
    expect(() => validateSlug("")).toThrow(InvalidSlugError);
    expect(() => validateSlug("HasUpperCase")).toThrow(InvalidSlugError);
    expect(() => validateSlug("with.dot")).toThrow(InvalidSlugError);
    expect(() => validateSlug("with_underscore")).toThrow(InvalidSlugError);
    expect(() => validateSlug("with space")).toThrow(InvalidSlugError);
    expect(() => validateSlug("-starts-with-dash")).toThrow(InvalidSlugError);
    expect(() => validateSlug("a".repeat(64))).toThrow(InvalidSlugError);
  });
});

describe("createProperty / listProperties", () => {
  beforeEach(() => freshDb());

  it("creates a property and returns the full ingest token", async () => {
    const p = await createProperty(getDb(), { slug: "marketing", name: "Marketing" });
    expect(p.slug).toBe("marketing");
    expect(p.name).toBe("Marketing");
    expect(p.ingestToken.length).toBeGreaterThan(20);
    expect(p.id).not.toBe("default");
  });

  it("lists active properties newest-first (excluding archived by default)", async () => {
    await createProperty(getDb(), { slug: "a", name: "A" });
    // Force a measurable timestamp gap so ordering is deterministic.
    await new Promise((r) => setTimeout(r, 5));
    await createProperty(getDb(), { slug: "b", name: "B" });
    const list = await listProperties(getDb());
    expect(list.length).toBe(2);
    expect(list[0]!.slug).toBe("b");
  });

  it("rejects duplicate slugs with SlugTakenError", async () => {
    await createProperty(getDb(), { slug: "marketing", name: "Marketing" });
    await expect(
      createProperty(getDb(), { slug: "marketing", name: "Other" }),
    ).rejects.toBeInstanceOf(SlugTakenError);
  });

  it("rejects invalid slugs with InvalidSlugError", async () => {
    await expect(
      createProperty(getDb(), { slug: "Bad Slug", name: "X" }),
    ).rejects.toBeInstanceOf(InvalidSlugError);
  });
});

describe("updateProperty / rotateIngestToken / archiveProperty", () => {
  beforeEach(() => freshDb());

  it("updates per-property notification overrides", async () => {
    const p = await createProperty(getDb(), { slug: "x", name: "X" });
    const updated = await updateProperty(getDb(), p.id, {
      notifyEmails: "ops@example.com",
      notifyWebhooks: "https://hooks.example/csp",
      muteCategories: "extension",
    });
    expect(updated?.notifyEmails).toBe("ops@example.com");
    expect(updated?.notifyWebhooks).toBe("https://hooks.example/csp");
    expect(updated?.muteCategories).toBe("extension");
  });

  it("rotates the ingest token", async () => {
    const p = await createProperty(getDb(), { slug: "x", name: "X" });
    const rotated = await rotateIngestToken(getDb(), p.id);
    expect(rotated?.ingestToken).not.toBe(p.ingestToken);
    expect(rotated?.ingestToken.length).toBeGreaterThan(20);
  });

  it("refuses to rotate the default property's token", async () => {
    const def = await ensureDefaultProperty(getDb());
    const result = await rotateIngestToken(getDb(), def.id);
    expect(result?.ingestToken).toBe("");
  });

  it("archives a property (soft delete)", async () => {
    const p = await createProperty(getDb(), { slug: "x", name: "X" });
    const archived = await archiveProperty(getDb(), p.id);
    expect(archived?.archivedAt).not.toBeNull();
    // Excluded from default list
    const list = await listProperties(getDb());
    expect(list.find((q) => q.id === p.id)).toBeUndefined();
    // Included with includeArchived
    const all = await listProperties(getDb(), { includeArchived: true });
    expect(all.find((q) => q.id === p.id)).toBeDefined();
  });

  it("refuses to archive the default property", async () => {
    const def = await ensureDefaultProperty(getDb());
    expect(await archiveProperty(getDb(), def.id)).toBeNull();
  });
});

describe("resolvePropertyForRequest", () => {
  beforeEach(() => freshDb());

  it("returns the default property when no slug is provided", async () => {
    const req = new Request("https://csp.example.com/report");
    const r = await resolvePropertyForRequest(getDb(), req);
    expect(r instanceof Response).toBe(false);
    expect((r as Property).id).toBe("default");
  });

  it("returns 404 for an unknown slug", async () => {
    const req = new Request("https://csp.example.com/r/missing");
    const r = await resolvePropertyForRequest(getDb(), req, { slug: "missing" });
    expect(r instanceof Response).toBe(true);
    expect((r as Response).status).toBe(404);
  });

  it("returns 401 when the token is missing", async () => {
    const created = await createProperty(getDb(), { slug: "marketing", name: "Marketing" });
    const req = new Request(`https://csp.example.com/r/${created.slug}`);
    const r = await resolvePropertyForRequest(getDb(), req, { slug: created.slug });
    expect(r instanceof Response).toBe(true);
    expect((r as Response).status).toBe(401);
  });

  it("returns 401 when the token is wrong", async () => {
    const created = await createProperty(getDb(), { slug: "marketing", name: "Marketing" });
    const req = new Request(`https://csp.example.com/r/${created.slug}?t=wrong`);
    const r = await resolvePropertyForRequest(getDb(), req, { slug: created.slug });
    expect((r as Response).status).toBe(401);
  });

  it("returns the property when token matches via ?t= query param", async () => {
    const created = await createProperty(getDb(), { slug: "marketing", name: "Marketing" });
    const req = new Request(`https://csp.example.com/r/${created.slug}?t=${created.ingestToken}`);
    const r = await resolvePropertyForRequest(getDb(), req, { slug: created.slug });
    expect(r instanceof Response).toBe(false);
    expect((r as Property).id).toBe(created.id);
  });

  it("returns the property when token matches via X-Ingest-Token header", async () => {
    const created = await createProperty(getDb(), { slug: "marketing", name: "Marketing" });
    const req = new Request(`https://csp.example.com/r/${created.slug}`, {
      headers: { "x-ingest-token": created.ingestToken },
    });
    const r = await resolvePropertyForRequest(getDb(), req, { slug: created.slug });
    expect(r instanceof Response).toBe(false);
    expect((r as Property).id).toBe(created.id);
  });
});

describe("ensureSeeded (BOOTSTRAP_PROPERTIES)", () => {
  beforeEach(() => freshDb());

  it("seeds properties from a JSON env var when the table is empty", async () => {
    const e = await freshDb({
      BOOTSTRAP_PROPERTIES: JSON.stringify([
        { slug: "marketing", name: "Marketing site" },
        {
          slug: "app",
          name: "Web app",
          emails: "ops@example.com",
          webhooks: "https://hooks.example/csp",
          muteCategories: "extension,browser-internal",
        },
      ]),
    });

    await ensureSeeded(getDb(), e);

    const list = await listProperties(getDb());
    expect(list.map((p) => p.slug).sort()).toEqual(["app", "marketing"]);

    const app = list.find((p) => p.slug === "app");
    expect(app?.notifyEmails).toBe("ops@example.com");
    expect(app?.notifyWebhooks).toBe("https://hooks.example/csp");
    expect(app?.muteCategories).toBe("extension,browser-internal");
  });

  it("is a no-op when at least one non-default property exists", async () => {
    await createProperty(getDb(), { slug: "existing", name: "Existing" });

    const e = await freshDb({
      BOOTSTRAP_PROPERTIES: JSON.stringify([{ slug: "marketing", name: "Marketing site" }]),
    });
    // Re-create the existing row since freshDb wiped the schema.
    await createProperty(getDb(), { slug: "existing", name: "Existing" });

    await ensureSeeded(getDb(), e);
    const list = await listProperties(getDb());
    expect(list.map((p) => p.slug)).toEqual(["existing"]);
  });

  it("ignores invalid JSON gracefully", async () => {
    const e = await freshDb({ BOOTSTRAP_PROPERTIES: "not json" });
    await expect(ensureSeeded(getDb(), e)).resolves.toBeUndefined();
    expect(await listProperties(getDb())).toEqual([]);
  });

  it("is cached per isolate", async () => {
    const e = await freshDb({
      BOOTSTRAP_PROPERTIES: JSON.stringify([{ slug: "once", name: "Once" }]),
    });

    await ensureSeeded(getDb(), e);
    expect((await listProperties(getDb())).length).toBe(1);

    // Drop and re-create — cache should make ensureSeeded skip.
    await getDb().prepare("DELETE FROM properties").run();
    await ensureSeeded(getDb(), e);
    expect((await listProperties(getDb())).length).toBe(0);
  });
});
