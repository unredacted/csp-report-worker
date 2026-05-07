/**
 * Issue grouping — write side.
 *
 * Upserts a row in `issues` keyed by (property_id, fingerprint), then inserts
 * a `issue_events` sample capped at EVENT_SAMPLE_CAP per issue.
 *
 * Read-side queries land in M2.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { RequestContext } from "./cf";
import type {
  AggregateBucket,
  Issue,
  IssueAggregates,
  IssueDetailResponse,
  IssueEvent,
  IssueStatus,
  ListIssuesResponse,
  NormalisedReport,
  Property,
  ReportCategory,
} from "./types";
import { browserFamily } from "./ua";

export type IssueTransition = "created" | "resurrected" | "noop";

export interface UpsertResult {
  /** What happened on this upsert — drives the notification gate. */
  transition: IssueTransition;
  /** True if this was the first occurrence — `null → open`. */
  created: boolean;
  /** True if a resolved issue was auto-reopened past the grace window. */
  resurrected: boolean;
  /** Pre-update status, or null if just created. */
  prevStatus: IssueStatus | null;
  /** Post-update status. */
  status: IssueStatus;
  /** Post-update event count. */
  eventCount: number;
  /** The composite issue id used for joins / detail URLs. */
  issueId: string;
}

/** Compose the deterministic issue id from a property and a fingerprint. */
export function issueIdFor(propertyId: string, fingerprint: string): string {
  return `${propertyId}:${fingerprint}`;
}

/**
 * Insert a new issue row, bump an existing one, or auto-reopen a resolved
 * issue whose grace window has elapsed.
 *
 * Returns a `transition` the caller uses to gate notifications:
 *   - `created`     — first time this fingerprint is seen for the property
 *   - `resurrected` — previously `resolved`, now `open` after grace
 *   - `noop`        — already-open / acknowledged / ignored / within grace
 *
 * SELECT-then-INSERT/UPDATE for clarity over UPSERT-with-RETURNING; the
 * extra round-trip is fine inside ctx.waitUntil().
 */
export async function upsertIssue(
  db: D1Database,
  property: Property,
  report: NormalisedReport,
  fingerprint: string,
  graceMs = 24 * 60 * 60 * 1000,
): Promise<UpsertResult> {
  const id = issueIdFor(property.id, fingerprint);
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);

  const existing = await db
    .prepare("SELECT status, event_count, resolved_at FROM issues WHERE id = ?")
    .bind(id)
    .first<{ status: IssueStatus; event_count: number; resolved_at: string | null }>();

  if (existing) {
    const past = existing.resolved_at != null && Date.parse(existing.resolved_at) + graceMs <= nowMs;
    const shouldResurrect = existing.status === "resolved" && past;

    if (shouldResurrect) {
      await db
        .prepare(
          `UPDATE issues SET status = 'open', resurrected_at = ?, last_seen = ?, event_count = event_count + 1 WHERE id = ?`,
        )
        .bind(now, now, id)
        .run();
      await db
        .prepare(
          `INSERT INTO issue_status_log (issue_id, from_status, to_status, actor, reason, at) VALUES (?, ?, 'open', 'system:resurrection', NULL, ?)`,
        )
        .bind(id, existing.status, now)
        .run();
      return {
        transition: "resurrected",
        created: false,
        resurrected: true,
        prevStatus: existing.status,
        status: "open",
        eventCount: existing.event_count + 1,
        issueId: id,
      };
    }

    await db
      .prepare("UPDATE issues SET event_count = event_count + 1, last_seen = ? WHERE id = ?")
      .bind(now, id)
      .run();
    return {
      transition: "noop",
      created: false,
      resurrected: false,
      prevStatus: existing.status,
      status: existing.status,
      eventCount: existing.event_count + 1,
      issueId: id,
    };
  }

  const sampleTitle = `${report.violatedDirective || report.effectiveDirective || "(unknown)"}: ${report.blockedUri || "(inline)"}`;

  await db
    .prepare(
      `INSERT INTO issues (
        id, property_id, fingerprint, status, category,
        violated_directive, effective_directive, blocked_uri, document_uri,
        source_file, line_number, column_number, sample_title,
        first_seen, last_seen, event_count
      ) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .bind(
      id,
      property.id,
      fingerprint,
      report.category,
      report.violatedDirective,
      report.effectiveDirective,
      report.blockedUri,
      report.documentUri,
      report.sourceFile || null,
      report.lineNumber || null,
      report.columnNumber || null,
      sampleTitle,
      now,
      now,
    )
    .run();

  return {
    transition: "created",
    created: true,
    resurrected: false,
    prevStatus: null,
    status: "open",
    eventCount: 1,
    issueId: id,
  };
}

/**
 * Update an issue's status, write an audit row, and stamp resolved_at when
 * transitioning to `resolved`.
 *
 * Returns the post-update issue status, or null if the issue doesn't exist.
 */
export async function setIssueStatus(
  db: D1Database,
  issueId: string,
  newStatus: IssueStatus,
  actor: string,
  reason?: string,
): Promise<IssueStatus | null> {
  const existing = await db
    .prepare("SELECT status FROM issues WHERE id = ?")
    .bind(issueId)
    .first<{ status: IssueStatus }>();
  if (!existing) return null;

  const now = new Date().toISOString();

  if (newStatus === "resolved") {
    await db
      .prepare("UPDATE issues SET status = ?, resolved_at = ? WHERE id = ?")
      .bind(newStatus, now, issueId)
      .run();
  } else {
    // Reopen / acknowledge / ignore: leave resolved_at intact as historical.
    await db
      .prepare("UPDATE issues SET status = ? WHERE id = ?")
      .bind(newStatus, issueId)
      .run();
  }

  await db
    .prepare(
      `INSERT INTO issue_status_log (issue_id, from_status, to_status, actor, reason, at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(issueId, existing.status, newStatus, actor, reason ?? null, now)
    .run();

  return newStatus;
}

export async function markNotified(db: D1Database, issueId: string): Promise<void> {
  await db
    .prepare("UPDATE issues SET notified_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), issueId)
    .run();
}

/**
 * Append an event to the per-issue rolling sample, then trim to `cap` rows.
 */
export async function insertEvent(
  db: D1Database,
  issueId: string,
  report: NormalisedReport,
  ctx: RequestContext,
  cap: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO issue_events (
        issue_id, report_id, ts, user_agent, status_code,
        country, asn, as_org, colo, cf_ray, http_protocol
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      issueId,
      report.id,
      report.timestamp,
      report.userAgent || null,
      report.statusCode || null,
      ctx.country,
      ctx.asn,
      ctx.asOrg,
      ctx.colo,
      ctx.cfRay,
      ctx.httpProtocol,
    )
    .run();

  // Trim to last `cap` events for this issue.
  await db
    .prepare(
      `DELETE FROM issue_events
       WHERE issue_id = ?
         AND id NOT IN (
           SELECT id FROM issue_events WHERE issue_id = ? ORDER BY id DESC LIMIT ?
         )`,
    )
    .bind(issueId, issueId, cap)
    .run();
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

interface IssueRow {
  id: string;
  property_id: string;
  fingerprint: string;
  status: IssueStatus;
  category: ReportCategory;
  violated_directive: string;
  effective_directive: string;
  blocked_uri: string;
  document_uri: string;
  source_file: string | null;
  line_number: number | null;
  column_number: number | null;
  sample_title: string;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  resurrected_at: string | null;
  event_count: number;
  notified_at: string | null;
}

interface EventRow {
  id: number;
  issue_id: string;
  report_id: string;
  ts: string;
  user_agent: string | null;
  status_code: number | null;
  country: string | null;
  asn: number | null;
  as_org: string | null;
  colo: string | null;
  cf_ray: string | null;
  http_protocol: string | null;
}

function rowToIssue(r: IssueRow): Issue {
  return {
    id: r.id,
    propertyId: r.property_id,
    fingerprint: r.fingerprint,
    status: r.status,
    category: r.category,
    violatedDirective: r.violated_directive,
    effectiveDirective: r.effective_directive,
    blockedUri: r.blocked_uri,
    documentUri: r.document_uri,
    sourceFile: r.source_file,
    lineNumber: r.line_number,
    columnNumber: r.column_number,
    sampleTitle: r.sample_title,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    resolvedAt: r.resolved_at,
    resurrectedAt: r.resurrected_at,
    eventCount: r.event_count,
    notifiedAt: r.notified_at,
  };
}

function rowToEvent(r: EventRow): IssueEvent {
  return {
    id: r.id,
    issueId: r.issue_id,
    reportId: r.report_id,
    ts: r.ts,
    userAgent: r.user_agent,
    statusCode: r.status_code,
    country: r.country,
    asn: r.asn,
    asOrg: r.as_org,
    colo: r.colo,
    cfRay: r.cf_ray,
    httpProtocol: r.http_protocol,
  };
}

const VALID_STATUSES: readonly IssueStatus[] = ["open", "acknowledged", "ignored", "resolved"];

export interface ListIssuesOptions {
  propertyId?: string;
  /** Inclusive set; empty/undefined = no status filter. */
  statuses?: readonly IssueStatus[];
  directive?: string;
  limit?: number;
  /** Opaque cursor from a previous response. */
  cursor?: string;
}

/** Encode/decode for keyset pagination. Cursor = base64("<lastSeen>|<id>"). */
function encodeCursor(lastSeen: string, id: string): string {
  return btoa(`${lastSeen}|${id}`);
}

function decodeCursor(cursor: string): { lastSeen: string; id: string } | null {
  try {
    const [lastSeen, ...rest] = atob(cursor).split("|");
    if (!lastSeen || rest.length === 0) return null;
    return { lastSeen, id: rest.join("|") };
  } catch {
    return null;
  }
}

export async function listIssues(
  db: D1Database,
  options: ListIssuesOptions = {},
): Promise<ListIssuesResponse> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const propertyId = options.propertyId ?? "default";

  const where: string[] = ["property_id = ?"];
  const params: (string | number)[] = [propertyId];

  if (options.statuses && options.statuses.length > 0) {
    const valid = options.statuses.filter((s) => VALID_STATUSES.includes(s));
    if (valid.length > 0) {
      where.push(`status IN (${valid.map(() => "?").join(", ")})`);
      params.push(...valid);
    }
  }

  if (options.directive) {
    where.push("violated_directive = ?");
    params.push(options.directive);
  }

  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (decoded) {
      where.push("(last_seen < ? OR (last_seen = ? AND id < ?))");
      params.push(decoded.lastSeen, decoded.lastSeen, decoded.id);
    }
  }

  const sql = `
    SELECT * FROM issues
    WHERE ${where.join(" AND ")}
    ORDER BY last_seen DESC, id DESC
    LIMIT ?
  `;
  params.push(limit + 1); // fetch one extra to detect "has next page"

  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<IssueRow>();
  const rows = result.results ?? [];

  let nextCursor: string | null = null;
  let trimmed = rows;
  if (rows.length > limit) {
    trimmed = rows.slice(0, limit);
    const last = trimmed[trimmed.length - 1]!;
    nextCursor = encodeCursor(last.last_seen, last.id);
  }

  return {
    issues: trimmed.map(rowToIssue),
    cursor: nextCursor,
  };
}

function topN(map: Map<string, number>, n: number): AggregateBucket[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function computeAggregates(events: IssueEvent[]): IssueAggregates {
  const byCountry = new Map<string, number>();
  const byAsn = new Map<string, number>();
  const byBrowser = new Map<string, number>();

  for (const e of events) {
    if (e.country) byCountry.set(e.country, (byCountry.get(e.country) ?? 0) + 1);
    if (e.asn != null) {
      const key = e.asOrg ? `AS${e.asn} (${e.asOrg})` : `AS${e.asn}`;
      byAsn.set(key, (byAsn.get(key) ?? 0) + 1);
    }
    const family = browserFamily(e.userAgent);
    byBrowser.set(family, (byBrowser.get(family) ?? 0) + 1);
  }

  return {
    countries: topN(byCountry, 5),
    asns: topN(byAsn, 5),
    browsers: topN(byBrowser, 5),
  };
}

export async function getIssue(
  db: D1Database,
  id: string,
): Promise<IssueDetailResponse | null> {
  const issueRow = await db
    .prepare("SELECT * FROM issues WHERE id = ?")
    .bind(id)
    .first<IssueRow>();
  if (!issueRow) return null;

  const eventsResult = await db
    .prepare("SELECT * FROM issue_events WHERE issue_id = ? ORDER BY ts DESC LIMIT 100")
    .bind(id)
    .all<EventRow>();
  const events = (eventsResult.results ?? []).map(rowToEvent);

  return {
    issue: rowToIssue(issueRow),
    events,
    aggregates: computeAggregates(events),
  };
}
