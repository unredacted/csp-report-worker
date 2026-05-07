/**
 * Thin fetch wrapper that injects the Bearer token, parses JSON, and
 * surfaces meaningful errors. All endpoints are same-origin so there
 * are no CORS concerns from the SPA side.
 */

import { getToken, clearToken } from "./auth";
import type {
  IssueDetailResponse,
  IssueStatus,
  ListIssuesResponse,
  ListPropertiesResponse,
  ListReportsResponse,
  NormalisedReport,
  PolicyPreviewResponse,
  PolicySelection,
  PolicySuggestions,
  PropertyResponse,
  ReportCategory,
} from "./types";

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
  /** Inclusive category set. An empty/undefined array means no category filter. */
  categories?: readonly ReportCategory[];
}

export async function listReports(
  params: ListReportsParams = {},
): Promise<ListReportsResponse> {
  const url = new URL("/reports", window.location.origin);
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  if (params.directive) url.searchParams.set("directive", params.directive);
  if (params.categories && params.categories.length > 0) {
    url.searchParams.set("category", params.categories.join(","));
  }

  const res = await authedFetch(url.pathname + url.search);
  return jsonOrThrow<ListReportsResponse>(res);
}

export async function getReport(id: string): Promise<NormalisedReport> {
  const res = await authedFetch(`/reports/${encodeURIComponent(id)}`);
  return jsonOrThrow<NormalisedReport>(res);
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface ListIssuesParams {
  property?: string;
  statuses?: readonly IssueStatus[];
  directive?: string;
  limit?: number;
  cursor?: string;
}

export async function listIssues(params: ListIssuesParams = {}): Promise<ListIssuesResponse> {
  const url = new URL("/issues", window.location.origin);
  if (params.property) url.searchParams.set("property", params.property);
  if (params.statuses && params.statuses.length > 0) {
    url.searchParams.set("status", params.statuses.join(","));
  }
  if (params.directive) url.searchParams.set("directive", params.directive);
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);

  const res = await authedFetch(url.pathname + url.search);
  return jsonOrThrow<ListIssuesResponse>(res);
}

export async function getIssue(id: string): Promise<IssueDetailResponse> {
  const res = await authedFetch(`/issues/${encodeURIComponent(id)}`);
  return jsonOrThrow<IssueDetailResponse>(res);
}

export async function patchIssue(
  id: string,
  status: IssueStatus,
  reason?: string,
): Promise<IssueDetailResponse> {
  const res = await authedFetch(`/issues/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reason }),
  });
  return jsonOrThrow<IssueDetailResponse>(res);
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export async function listProperties(): Promise<ListPropertiesResponse> {
  const res = await authedFetch("/properties");
  return jsonOrThrow<ListPropertiesResponse>(res);
}

export interface CreatePropertyParams {
  slug: string;
  name: string;
  emails?: string;
  webhooks?: string;
  muteCategories?: string;
}

export async function createProperty(params: CreatePropertyParams): Promise<PropertyResponse> {
  const res = await authedFetch("/properties", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<PropertyResponse>(res);
}

export interface PatchPropertyParams {
  name?: string;
  emails?: string | null;
  webhooks?: string | null;
  muteCategories?: string | null;
}

export async function patchProperty(
  id: string,
  params: PatchPropertyParams,
): Promise<PropertyResponse> {
  const res = await authedFetch(`/properties/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<PropertyResponse>(res);
}

export async function rotateIngestToken(id: string): Promise<PropertyResponse> {
  const res = await authedFetch(`/properties/${encodeURIComponent(id)}/rotate-token`, {
    method: "POST",
  });
  return jsonOrThrow<PropertyResponse>(res);
}

export async function archiveProperty(id: string): Promise<PropertyResponse> {
  const res = await authedFetch(`/properties/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  });
  return jsonOrThrow<PropertyResponse>(res);
}

// ---------------------------------------------------------------------------
// Policy assistant
// ---------------------------------------------------------------------------

export async function getPolicySuggestions(propertyId: string): Promise<PolicySuggestions> {
  const res = await authedFetch(`/properties/${encodeURIComponent(propertyId)}/policy-suggestions`);
  return jsonOrThrow<PolicySuggestions>(res);
}

export async function previewPolicy(
  propertyId: string,
  baseline: string,
  selections: PolicySelection[],
): Promise<PolicyPreviewResponse> {
  const res = await authedFetch(`/properties/${encodeURIComponent(propertyId)}/policy-preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseline, selections }),
  });
  return jsonOrThrow<PolicyPreviewResponse>(res);
}
