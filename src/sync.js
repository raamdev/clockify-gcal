/**
 * sync.js
 * Core sync engine.
 * Runs every 15 minutes (via node-cron) and keeps Google Calendar
 * in sync with Clockify time entries for the last 7 days.
 *
 * Algorithm:
 *   1. Fetch Clockify entries for [now-7d, now]
 *   2. Fetch GCal events in the same window that have clockifySync=true
 *   3. Build a diff:
 *      - Clockify entry not in sync_map  → CREATE in GCal, insert sync_map
 *      - Clockify entry in sync_map, content changed → UPDATE GCal event
 *      - sync_map entry whose clockifyId is gone from Clockify → DELETE from GCal
 */

const cron = require('node-cron');
const crypto = require('crypto');
const storage = require('./storage');
const clockify = require('./clockify');
const gcal = require('./gcal');

// Project name cache (per sync run) to avoid redundant API calls
const projectCache = new Map();

/**
 * Compute a stable hash for a Clockify entry so we can detect changes cheaply.
 */
function hashEntry(entry) {
  const sig = [
    entry.description || '',
    entry.timeInterval?.start || '',
    entry.timeInterval?.end   || '',
    entry.projectId || '',
    entry.taskId || '',
    (entry.tags || []).map(t => t.id).sort().join(','),
  ].join('|');
  return crypto.createHash('sha1').update(sig).digest('hex');
}

/**
 * Sync a single workspace.
 */
async function syncWorkspace(workspace) {
  const {
    workspace_id: workspaceId,
    user_id:       userId,
    addon_token:   addonToken,
    googleTokens,
    calendar_id:   calendarId = 'primary',
  } = workspace;

  if (!googleTokens?.refresh_token) {
    console.log(`[sync] ${workspaceId}: skipping — Google not connected`);
    return { created: 0, updated: 0, deleted: 0 };
  }

  // Build authenticated Google client, persist any refreshed tokens
  const authClient = gcal.buildAuthClient(googleTokens, (newTokens) => {
    storage.saveGoogleTokens(workspaceId, newTokens, null);
  });

  // Time window: last 7 days → now (UTC ISO)
  const now   = new Date();
  const start = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const startISO = start.toISOString();
  const endISO   = now.toISOString();

  // ── 1. Fetch Clockify entries ──────────────────────────────────────────────
  const entries = await clockify.getTimeEntries(addonToken, workspaceId, userId, startISO, endISO);

  // Filter out any "running" entries (no end time yet)
  const completedEntries = entries.filter(e => e.timeInterval?.end);

  // Build a Map<clockifyId, entry> for quick lookup
  const entryMap = new Map(completedEntries.map(e => [e.id, e]));

  // ── 2. Load sync map from DB ───────────────────────────────────────────────
  const syncMap = storage.getSyncMap(workspaceId); // Map<clockifyId, { gcalEventId, lastHash }>

  // ── 3. Diff and sync ──────────────────────────────────────────────────────
  let created = 0, updated = 0, deleted = 0;

  // CREATE or UPDATE
  for (const [clockifyId, entry] of entryMap) {
    const hash = hashEntry(entry);
    const existing = syncMap.get(clockifyId);

    const eventResource = gcal.buildEventResource(entry, projectCache);

    if (!existing) {
      // New entry → create GCal event
      try {
        const event = await gcal.createEvent(authClient, calendarId, eventResource);
        storage.upsertSyncEntry(workspaceId, clockifyId, event.id, hash);
        created++;
        console.log(`[sync] ${workspaceId}: created event "${eventResource.summary}"`);
      } catch (err) {
        console.error(`[sync] ${workspaceId}: failed to create event for ${clockifyId}:`, err.message);
      }
    } else if (existing.lastHash !== hash) {
      // Changed entry → update GCal event
      try {
        await gcal.updateEvent(authClient, calendarId, existing.gcalEventId, eventResource);
        storage.upsertSyncEntry(workspaceId, clockifyId, existing.gcalEventId, hash);
        updated++;
        console.log(`[sync] ${workspaceId}: updated event "${eventResource.summary}"`);
      } catch (err) {
        if (err.code === 404 || err.status === 404) {
          // GCal event was deleted externally — recreate it
          try {
            const event = await gcal.createEvent(authClient, calendarId, eventResource);
            storage.upsertSyncEntry(workspaceId, clockifyId, event.id, hash);
            created++;
            console.log(`[sync] ${workspaceId}: recreated missing event "${eventResource.summary}"`);
          } catch (e2) {
            console.error(`[sync] ${workspaceId}: failed to recreate event:`, e2.message);
          }
        } else {
          console.error(`[sync] ${workspaceId}: failed to update event ${existing.gcalEventId}:`, err.message);
        }
      }
    }
    // If hash matches → no change needed
  }

  // DELETE — entries in sync_map that no longer exist in Clockify
  for (const [clockifyId, { gcalEventId }] of syncMap) {
    if (!entryMap.has(clockifyId)) {
      try {
        await gcal.deleteEvent(authClient, calendarId, gcalEventId);
        deleted++;
        console.log(`[sync] ${workspaceId}: deleted event for removed entry ${clockifyId}`);
      } catch (err) {
        if (err.code === 410 || err.status === 410 || err.code === 404 || err.status === 404) {
          // Already gone, that's fine
        } else {
          console.error(`[sync] ${workspaceId}: failed to delete event ${gcalEventId}:`, err.message);
        }
      }
      // Remove from sync map regardless
      storage.deleteSyncEntry(workspaceId, clockifyId);
    }
  }

  return { created, updated, deleted };
}

/**
 * Run sync for all connected workspaces.
 */
async function runSync() {
  const workspaces = storage.getAllWorkspaces();
  console.log(`[sync] Starting sync run for ${workspaces.length} workspace(s)`);
  projectCache.clear();

  for (const workspace of workspaces) {
    try {
      const stats = await syncWorkspace(workspace);
      storage.logSyncRun(workspace.workspace_id, stats);
      console.log(
        `[sync] ${workspace.workspace_id}: +${stats.created} ~${stats.updated} -${stats.deleted}`
      );
    } catch (err) {
      console.error(`[sync] ${workspace.workspace_id}: sync failed:`, err.message);
      storage.logSyncRun(workspace.workspace_id, { error: err.message });
    }
  }
}

/**
 * Start the scheduler. Runs at :00, :15, :30, :45 every hour.
 */
function startScheduler() {
  console.log('[sync] Scheduler started — running every 15 minutes');

  // Run immediately on startup so you don't wait 15 min for first sync
  runSync().catch(err => console.error('[sync] Initial run error:', err));

  cron.schedule('*/15 * * * *', () => {
    runSync().catch(err => console.error('[sync] Cron error:', err));
  });
}

module.exports = { startScheduler, runSync, syncWorkspace };
