/**
 * Tests for email provider factory and provider implementations.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEmailProvider } from "../src/notify/provider";
import type { EmailProvider } from "../src/notify/provider";
import type { Env } from "../src/types";
import { getEmailProvider } from "../src/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Env with defaults for testing. */
function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    CSP_REPORTS: {} as KVNamespace,
    NOTIFY_EMAILS: "",
    NOTIFY_WEBHOOKS: "",
    DEDUP_WINDOW_MINUTES: "60",
    KV_TTL_SECONDS: "604800",
    ALLOWED_ORIGINS: "",
    EMAIL_FROM: "test@example.com",
    API_TOKEN: "test-token",
    ...overrides,
  } as Env;
}

// ---------------------------------------------------------------------------
// getEmailProvider() config parser
// ---------------------------------------------------------------------------

describe("getEmailProvider", () => {
  it("should return null for empty EMAIL_PROVIDER", () => {
    expect(getEmailProvider(testEnv())).toBeNull();
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "" }))).toBeNull();
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "  " }))).toBeNull();
  });

  it("should return the correct provider type for valid values", () => {
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "mailgun" }))).toBe("mailgun");
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "ses" }))).toBe("ses");
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "resend" }))).toBe("resend");
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "cloudflare-email" }))).toBe("cloudflare-email");
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "cloudflare-routing" }))).toBe("cloudflare-routing");
  });

  it("should be case-insensitive", () => {
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "Mailgun" }))).toBe("mailgun");
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "SES" }))).toBe("ses");
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "RESEND" }))).toBe("resend");
  });

  it("should return null and warn for unknown providers", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getEmailProvider(testEnv({ EMAIL_PROVIDER: "sendgrid" }))).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown EMAIL_PROVIDER"),
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// createEmailProvider() factory
// ---------------------------------------------------------------------------

describe("createEmailProvider", () => {
  it("should return null when EMAIL_PROVIDER is not set", () => {
    expect(createEmailProvider(testEnv())).toBeNull();
  });

  it("should return null when cloudflare-routing is selected but EMAIL binding is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createEmailProvider(testEnv({ EMAIL_PROVIDER: "cloudflare-routing" }));
    expect(provider).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("EMAIL binding not available"),
    );
    warnSpy.mockRestore();
  });

  it("should return null when cloudflare-email is selected but EMAIL binding is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createEmailProvider(testEnv({ EMAIL_PROVIDER: "cloudflare-email" }));
    expect(provider).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("EMAIL binding not available"),
    );
    warnSpy.mockRestore();
  });

  it("should return a provider when cloudflare-email is configured with an EMAIL binding", () => {
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "cloudflare-email",
      EMAIL: { send: vi.fn() } as any,
    }));
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
  });

  it("should return null when mailgun is selected but MAILGUN_API_KEY is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_DOMAIN: "mg.example.com",
    }));
    expect(provider).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("MAILGUN_API_KEY or MAILGUN_DOMAIN not set"),
    );
    warnSpy.mockRestore();
  });

  it("should return null when mailgun is selected but MAILGUN_DOMAIN is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_KEY: "key-abc123",
    }));
    expect(provider).toBeNull();
    warnSpy.mockRestore();
  });

  it("should return a provider when mailgun is fully configured", () => {
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_KEY: "key-abc123",
      MAILGUN_DOMAIN: "mg.example.com",
    }));
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
  });

  it("should return null when ses is selected but credentials are missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "ses",
    }));
    expect(provider).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("AWS_SES_ACCESS_KEY_ID or AWS_SES_SECRET_ACCESS_KEY not set"),
    );
    warnSpy.mockRestore();
  });

  it("should return a provider when ses is fully configured", () => {
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "ses",
      AWS_SES_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      AWS_SES_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      AWS_SES_REGION: "us-east-1",
    }));
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
  });

  it("should return null when resend is selected but API key is missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "resend",
    }));
    expect(provider).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("RESEND_API_KEY not set"),
    );
    warnSpy.mockRestore();
  });

  it("should return a provider when resend is fully configured", () => {
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_123456789",
    }));
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
  });
});

// ---------------------------------------------------------------------------
// Mailgun provider send()
// ---------------------------------------------------------------------------

describe("mailgun provider send()", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should POST to the US Mailgun endpoint with correct auth and body", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = mockFetch;

    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_KEY: "key-abc123",
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_REGION: "us",
    }))!;

    await provider.send({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Test Subject",
      text: "Plain text",
      html: "<p>HTML</p>",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.mailgun.net/v3/mg.example.com/messages");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Basic ${btoa("api:key-abc123")}`);
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    // Parse the body to verify fields
    const params = new URLSearchParams(init.body);
    expect(params.get("from")).toBe("sender@example.com");
    expect(params.get("to")).toBe("recipient@example.com");
    expect(params.get("subject")).toBe("Test Subject");
    expect(params.get("text")).toBe("Plain text");
    expect(params.get("html")).toBe("<p>HTML</p>");
  });

  it("should use EU endpoint when MAILGUN_REGION is 'eu'", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = mockFetch;

    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_KEY: "key-abc123",
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_REGION: "eu",
    }))!;

    await provider.send({
      from: "s@e.com",
      to: "r@e.com",
      subject: "S",
      text: "T",
      html: "H",
    });

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.eu.mailgun.net/v3/mg.example.com/messages");
  });

  it("should throw on non-OK response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403 }),
    );
    globalThis.fetch = mockFetch;

    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "mailgun",
      MAILGUN_API_KEY: "key-abc123",
      MAILGUN_DOMAIN: "mg.example.com",
    }))!;

    await expect(
      provider.send({ from: "a@b.com", to: "c@d.com", subject: "S", text: "T", html: "H" }),
    ).rejects.toThrow("Mailgun 403");
  });
});

// ---------------------------------------------------------------------------
// Resend provider send()
// ---------------------------------------------------------------------------

describe("resend provider send()", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should POST to the Resend endpoint with correct auth and JSON body", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_123" }), { status: 200 }),
    );
    globalThis.fetch = mockFetch;

    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_123456789",
    }))!;

    await provider.send({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Test Subject",
      text: "Plain text",
      html: "<p>HTML</p>",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_123456789");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body);
    expect(body.from).toBe("sender@example.com");
    expect(body.to).toBe("recipient@example.com");
    expect(body.subject).toBe("Test Subject");
    expect(body.text).toBe("Plain text");
    expect(body.html).toBe("<p>HTML</p>");
  });

  it("should throw on non-OK response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    globalThis.fetch = mockFetch;

    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_invalid",
    }))!;

    await expect(
      provider.send({ from: "a@b.com", to: "c@d.com", subject: "S", text: "T", html: "H" }),
    ).rejects.toThrow("Resend 401");
  });
});

// ---------------------------------------------------------------------------
// Cloudflare Email Service (send_email binding) provider send()
// ---------------------------------------------------------------------------

describe("cloudflare-email provider send()", () => {
  it("should call env.EMAIL.send with the structured payload", async () => {
    const mockSend = vi.fn().mockResolvedValue(undefined);
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "cloudflare-email",
      EMAIL: { send: mockSend } as any,
    }))!;

    await provider.send({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Test Subject",
      text: "Plain text",
      html: "<p>HTML</p>",
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Test Subject",
      text: "Plain text",
      html: "<p>HTML</p>",
    });
  });

  it("should propagate errors from the binding", async () => {
    const mockSend = vi.fn().mockRejectedValue(new Error("verified sender required"));
    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "cloudflare-email",
      EMAIL: { send: mockSend } as any,
    }))!;

    await expect(
      provider.send({ from: "a@b.com", to: "c@d.com", subject: "S", text: "T", html: "H" }),
    ).rejects.toThrow("verified sender required");
  });
});

// ---------------------------------------------------------------------------
// SES provider send()
// ---------------------------------------------------------------------------

describe("ses provider send()", () => {
  // SES uses aws4fetch which wraps fetch internally.
  // We mock globalThis.fetch to intercept the signed request.
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should POST to the SES v2 endpoint with a JSON body", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ MessageId: "abc123" }), { status: 200 }),
    );
    globalThis.fetch = mockFetch;

    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "ses",
      AWS_SES_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      AWS_SES_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      AWS_SES_REGION: "us-west-2",
    }))!;

    await provider.send({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Test",
      text: "Text body",
      html: "<p>HTML body</p>",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;

    // aws4fetch constructs a Request object, so we need to handle both cases
    const requestUrl = url instanceof Request ? url.url : url;
    expect(requestUrl).toContain("email.us-west-2.amazonaws.com");
    expect(requestUrl).toContain("/v2/email/outbound-emails");
  });

  it("should throw on non-OK response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("AccessDenied", { status: 403 }),
    );
    globalThis.fetch = mockFetch;

    const provider = createEmailProvider(testEnv({
      EMAIL_PROVIDER: "ses",
      AWS_SES_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      AWS_SES_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    }))!;

    await expect(
      provider.send({ from: "a@b.com", to: "c@d.com", subject: "S", text: "T", html: "H" }),
    ).rejects.toThrow("SES 403");
  });
});
