/**
 * Thin fetch wrapper that injects the Bearer token, parses JSON, and
 * surfaces meaningful errors. All endpoints are same-origin so there
 * are no CORS concerns from the SPA side.
 */

import { getToken, clearToken } from "./auth";
import type { ListReportsResponse, NormalisedReport, ReportCategory } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401 || res.status === 403) {
    // Token is bad — clear it so the router redirects to /login.
    clearToken();
  }
  return res;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body — keep the status text
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

/**
 * Validate the configured token. Returns true if the worker accepts it.
 */
export async function checkAuth(token: string): Promise<boolean> {
  const res = await fetch("/auth/check", {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status === 204;
}

export interface ListReportsParams {
  limit?: number;
  cursor?: string;
  directive?: string;
  category?: ReportCategory;
}

export async function listReports(
  params: ListReportsParams = {},
): Promise<ListReportsResponse> {
  const url = new URL("/reports", window.location.origin);
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  if (params.directive) url.searchParams.set("directive", params.directive);
  if (params.category) url.searchParams.set("category", params.category);

  const res = await authedFetch(url.pathname + url.search);
  return jsonOrThrow<ListReportsResponse>(res);
}

export async function getReport(id: string): Promise<NormalisedReport> {
  const res = await authedFetch(`/reports/${encodeURIComponent(id)}`);
  return jsonOrThrow<NormalisedReport>(res);
}
