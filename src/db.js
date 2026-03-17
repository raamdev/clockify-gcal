const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/addon.db');

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    -- Installed workspaces with their installation tokens
    CREATE TABLE IF NOT EXISTS workspaces (
      workspace_id   TEXT PRIMARY KEY,
      installation_token TEXT NOT NULL,
      backend_url    TEXT NOT NULL DEFAULT 'https://api.clockify.me/api',
      addon_id       TEXT,
      installed_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Google OAuth tokens per (workspace, user)
    CREATE TABLE IF NOT EXISTS google_tokens (
      workspace_id   TEXT NOT NULL,
      user_id        TEXT NOT NULL,
      access_token   TEXT NOT NULL,
      refresh_token  TEXT,
      expiry_date    INTEGER,
      calendar_id    TEXT NOT NULL DEFAULT 'primary',
      connected_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, user_id)
    );

    -- Sync configuration per (workspace, user)
    CREATE TABLE IF NOT EXISTS sync_config (
      workspace_id          TEXT NOT NULL,
      user_id               TEXT NOT NULL,
      days_back             INTEGER NOT NULL DEFAULT 30,
      days_forward          INTEGER NOT NULL DEFAULT 0,
      sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
      enabled               INTEGER NOT NULL DEFAULT 1,
      last_sync_at          DATETIME,
      PRIMARY KEY (workspace_id, user_id)
    );

    -- Maps Clockify entry IDs → Google Calendar event IDs
    CREATE TABLE IF NOT EXISTS sync_map (
      workspace_id           TEXT NOT NULL,
      user_id                TEXT NOT NULL,
      clockify_entry_id      TEXT NOT NULL,
      gcal_event_id          TEXT NOT NULL,
      gcal_calendar_id       TEXT NOT NULL,
      clockify_fingerprint   TEXT,       -- hash of end+description+projectId to detect changes
      synced_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, clockify_entry_id)
    );
  `);

  console.log('[DB] Initialized:', DB_PATH);
}

module.exports = { getDb, initDb };
