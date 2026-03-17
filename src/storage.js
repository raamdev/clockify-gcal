/**
 * storage.js
 * SQLite-backed persistence for per-workspace addon state.
 * Stores: installation tokens, Google OAuth tokens, and the clockifyId→gcalEventId map.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/addon.db';

// Ensure data directory exists
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = new Database(path.resolve(DB_PATH));

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    workspace_id   TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    addon_token    TEXT NOT NULL,          -- installation-level addon token from lifecycle hook
    google_tokens  TEXT,                   -- JSON: { access_token, refresh_token, expiry_date }
    calendar_id    TEXT DEFAULT 'primary', -- Google Calendar ID to sync into
    sync_enabled   INTEGER DEFAULT 1,
    created_at     INTEGER DEFAULT (unixepoch()),
    updated_at     INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sync_map (
    workspace_id    TEXT NOT NULL,
    clockify_id     TEXT NOT NULL,         -- Clockify time entry ID
    gcal_event_id   TEXT NOT NULL,         -- Google Calendar event ID
    last_hash       TEXT NOT NULL,         -- hash of entry content to detect changes
    synced_at       INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (workspace_id, clockify_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    run_at       INTEGER DEFAULT (unixepoch()),
    entries_created  INTEGER DEFAULT 0,
    entries_updated  INTEGER DEFAULT 0,
    entries_deleted  INTEGER DEFAULT 0,
    error        TEXT
  );
`);

// ─── Workspace helpers ────────────────────────────────────────────────────────

function upsertWorkspace({ workspaceId, userId, addonToken }) {
  db.prepare(`
    INSERT INTO workspaces (workspace_id, user_id, addon_token, updated_at)
    VALUES (?, ?, ?, unixepoch())
    ON CONFLICT(workspace_id) DO UPDATE SET
      user_id    = excluded.user_id,
      addon_token = excluded.addon_token,
      updated_at  = unixepoch()
  `).run(workspaceId, userId, addonToken);
}

function getWorkspace(workspaceId) {
  const row = db.prepare('SELECT * FROM workspaces WHERE workspace_id = ?').get(workspaceId);
  if (!row) return null;
  return {
    ...row,
    googleTokens: row.google_tokens ? JSON.parse(row.google_tokens) : null,
    syncEnabled: row.sync_enabled === 1,
  };
}

function getAllWorkspaces() {
  return db.prepare('SELECT * FROM workspaces WHERE sync_enabled = 1').all().map(row => ({
    ...row,
    googleTokens: row.google_tokens ? JSON.parse(row.google_tokens) : null,
    syncEnabled: true,
  }));
}

function saveGoogleTokens(workspaceId, tokens, calendarId) {
  db.prepare(`
    UPDATE workspaces
    SET google_tokens = ?, calendar_id = COALESCE(?, calendar_id), updated_at = unixepoch()
    WHERE workspace_id = ?
  `).run(JSON.stringify(tokens), calendarId || null, workspaceId);
}

function removeWorkspace(workspaceId) {
  db.prepare('DELETE FROM workspaces WHERE workspace_id = ?').run(workspaceId);
}

// ─── Sync map helpers ─────────────────────────────────────────────────────────

function getSyncMap(workspaceId) {
  const rows = db.prepare('SELECT * FROM sync_map WHERE workspace_id = ?').all(workspaceId);
  // Returns: Map<clockifyId, { gcalEventId, lastHash }>
  const map = new Map();
  for (const row of rows) {
    map.set(row.clockify_id, { gcalEventId: row.gcal_event_id, lastHash: row.last_hash });
  }
  return map;
}

function upsertSyncEntry(workspaceId, clockifyId, gcalEventId, lastHash) {
  db.prepare(`
    INSERT INTO sync_map (workspace_id, clockify_id, gcal_event_id, last_hash, synced_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(workspace_id, clockify_id) DO UPDATE SET
      gcal_event_id = excluded.gcal_event_id,
      last_hash     = excluded.last_hash,
      synced_at     = unixepoch()
  `).run(workspaceId, clockifyId, gcalEventId, lastHash);
}

function deleteSyncEntry(workspaceId, clockifyId) {
  db.prepare('DELETE FROM sync_map WHERE workspace_id = ? AND clockify_id = ?').run(workspaceId, clockifyId);
}

// ─── Sync log helpers ─────────────────────────────────────────────────────────

function logSyncRun(workspaceId, { created, updated, deleted, error }) {
  db.prepare(`
    INSERT INTO sync_log (workspace_id, entries_created, entries_updated, entries_deleted, error)
    VALUES (?, ?, ?, ?, ?)
  `).run(workspaceId, created || 0, updated || 0, deleted || 0, error || null);
}

function getRecentLogs(workspaceId, limit = 10) {
  return db.prepare(`
    SELECT * FROM sync_log WHERE workspace_id = ? ORDER BY run_at DESC LIMIT ?
  `).all(workspaceId, limit);
}

module.exports = {
  upsertWorkspace,
  getWorkspace,
  getAllWorkspaces,
  saveGoogleTokens,
  removeWorkspace,
  getSyncMap,
  upsertSyncEntry,
  deleteSyncEntry,
  logSyncRun,
  getRecentLogs,
};
