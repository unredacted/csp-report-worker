/**
 * Email provider interface and factory.
 *
 * Abstracts over Cloudflare Email Workers, Mailgun, AWS SES, and Resend
 * so the active backend is selected by the EMAIL_PROVIDER env var.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Env } from "../types";
import { getEmailProvider } from "../config";
import type { EmailProviderType } from "../config";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EmailProviderOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  send(opts: EmailProviderOptions): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the email provider selected by `EMAIL_PROVIDER`, or `null` if
 * email is disabled / unconfigured.
 */
export function createEmailProvider(env: Env): EmailProvider | null {
  const provider = getEmailProvider(env);
  if (!provider) return null;

  switch (provider) {
    case "cloudflare":
      return createCloudflareProvider(env);
    case "mailgun":
      return createMailgunProvider(env);
    case "ses":
      return createSesProvider(env);
    case "resend":
      return createResendProvider(env);
    default: {
      // Exhaustive check — TypeScript will error if a case is missed
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Cloudflare Send Email Workers
// ---------------------------------------------------------------------------

function createCloudflareProvider(env: Env): EmailProvider | null {
  if (!env.EMAIL) {
    console.warn("[email:cloudflare] EMAIL binding not available — skipping");
    return null;
  }

  // Dynamic imports would be cleaner, but top-level await isn't available
  // in all contexts. We lazily import inside send() instead.
  const emailBinding = env.EMAIL;

  return {
    async send(opts: EmailProviderOptions): Promise<void> {
      // Lazy imports — only loaded when the cloudflare provider is active
      const { EmailMessage } = await import("cloudflare:email");
      const { createMimeMessage } = await import("mimetext/browser");

      const msg = createMimeMessage();
      msg.setSender({ addr: opts.from });
      msg.setRecipient(opts.to);
      msg.setSubject(opts.subject);
      msg.addMessage({ contentType: "text/plain", data: opts.text });
      msg.addMessage({ contentType: "text/html", data: opts.html });

      const message = new EmailMessage(opts.from, opts.to, msg.asRaw());
      await emailBinding.send(message);
    },
  };
}

// ---------------------------------------------------------------------------
// Mailgun
// ---------------------------------------------------------------------------

function createMailgunProvider(env: Env): EmailProvider | null {
  const apiKey = env.MAILGUN_API_KEY?.trim();
  const domain = env.MAILGUN_DOMAIN?.trim();

  if (!apiKey || !domain) {
    console.warn("[email:mailgun] MAILGUN_API_KEY or MAILGUN_DOMAIN not set — skipping");
    return null;
  }

  const region = env.MAILGUN_REGION?.trim().toLowerCase() === "eu" ? "eu" : "us";
  const baseUrl = region === "eu"
    ? `https://api.eu.mailgun.net/v3/${domain}/messages`
    : `https://api.mailgun.net/v3/${domain}/messages`;
  const authHeader = `Basic ${btoa(`api:${apiKey}`)}`;

  return {
    async send(opts: EmailProviderOptions): Promise<void> {
      const body = new URLSearchParams({
        from: opts.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "(no body)");
        throw new Error(`Mailgun ${res.status}: ${text}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// AWS SES (via aws4fetch)
// ---------------------------------------------------------------------------

function createSesProvider(env: Env): EmailProvider | null {
  const accessKeyId = env.AWS_SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SES_SECRET_ACCESS_KEY?.trim();
  const region = env.AWS_SES_REGION?.trim() || "us-east-1";

  if (!accessKeyId || !secretAccessKey) {
    console.warn("[email:ses] AWS_SES_ACCESS_KEY_ID or AWS_SES_SECRET_ACCESS_KEY not set — skipping");
    return null;
  }

  return {
    async send(opts: EmailProviderOptions): Promise<void> {
      // Lazy import — only loaded when the SES provider is active
      const { AwsClient } = await import("aws4fetch");

      const client = new AwsClient({
        accessKeyId,
        secretAccessKey,
        region,
        service: "ses",
        retries: 0,
      });

      const endpoint = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;
      const payload = {
        FromEmailAddress: opts.from,
        Destination: {
          ToAddresses: [opts.to],
        },
        Content: {
          Simple: {
            Subject: { Data: opts.subject },
            Body: {
              Text: { Data: opts.text },
              Html: { Data: opts.html },
            },
          },
        },
      };

      const res = await client.fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "(no body)");
        throw new Error(`SES ${res.status}: ${text}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

function createResendProvider(env: Env): EmailProvider | null {
  const apiKey = env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    console.warn("[email:resend] RESEND_API_KEY not set — skipping");
    return null;
  }

  return {
    async send(opts: EmailProviderOptions): Promise<void> {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: opts.from,
          to: opts.to,
          subject: opts.subject,
          text: opts.text,
          html: opts.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "(no body)");
        throw new Error(`Resend ${res.status}: ${text}`);
      }
    },
  };
}
