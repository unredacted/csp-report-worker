/**
 * D1 migrations, compiled to TS so the worker bundle includes them.
 *
 * Mirror of migrations/0001_init.sql — keep them in sync.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Migration {
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    name: "0001_init",
    statements: [
      `CREATE TABLE IF NOT EXISTS properties (
        id            TEXT PRIMARY KEY,
        slug          TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        ingest_token  TEXT NOT NULL,
        notify_emails    TEXT,
        notify_webhooks  TEXT,
        mute_categories  TEXT,
        created_at    TEXT NOT NULL,
        archived_at   TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS issues (
        id                  TEXT PRIMARY KEY,
        property_id         TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        fingerprint         TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','ignored','resolved')),
        category            TEXT NOT NULL,
        violated_directive  TEXT NOT NULL,
        effective_directive TEXT NOT NULL,
        blocked_uri         TEXT NOT NULL,
        document_uri        TEXT NOT NULL,
        source_file         TEXT,
        line_number         INTEGER,
        column_number       INTEGER,
        sample_title        TEXT NOT NULL,
        first_seen          TEXT NOT NULL,
        last_seen           TEXT NOT NULL,
        resolved_at         TEXT,
        resurrected_at      TEXT,
        event_count         INTEGER NOT NULL DEFAULT 0,
        notified_at         TEXT,
        UNIQUE(property_id, fingerprint)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_issues_status_lastseen ON issues(property_id, status, last_seen DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_issues_lastseen ON issues(last_seen DESC)`,
      `CREATE TABLE IF NOT EXISTS issue_events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id      TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        report_id     TEXT NOT NULL,
        ts            TEXT NOT NULL,
        user_agent    TEXT,
        status_code   INTEGER,
        country       TEXT,
        asn           INTEGER,
        as_org        TEXT,
        colo          TEXT,
        cf_ray        TEXT,
        http_protocol TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_events_issue_ts ON issue_events(issue_id, ts DESC)`,
      `CREATE TABLE IF NOT EXISTS issue_status_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_id    TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        from_status TEXT,
        to_status   TEXT NOT NULL,
        actor       TEXT,
        reason      TEXT,
        at          TEXT NOT NULL
      )`,
    ],
  },
];
