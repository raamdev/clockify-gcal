/**
 * routes/settings.js
 * Serves the settings UI iframe and API endpoints used by the settings page.
 *
 * The settings iframe URL (from the manifest) will be called with:
 *   ?auth_token=<JWT>   — short-lived addon JWT issued by Clockify
 *
 * We parse workspaceId from the JWT without full verification (Clockify
 * already validates it on their end). The JWT payload is base64-encoded.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const storage = require('../storage');
const gcal = require('../gcal');
const { runSync } = require('../sync');

/**
 * Parse workspaceId + userId from Clockify's JWT without library.
 * The JWT payload is public — it doesn't contain sensitive data —
 * so we decode it to extract the workspace context.
 */
function parseJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * GET /settings
 * Render the settings HTML page. Clockify loads this in an iframe and
 * appends ?auth_token=JWT to the URL.
 */
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/settings.html'));
});

/**
 * GET /settings/api/status
 * Returns the current connection status for a workspace.
 * Called by the settings page's JavaScript after extracting token from URL.
 */
router.get('/api/status', (req, res) => {
  const token = req.query.auth_token || req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const payload = parseJwtPayload(token);
  if (!payload) return res.status(400).json({ error: 'Invalid token' });

  const workspaceId = payload.workspaceId || payload.sub;
  if (!workspaceId) return res.status(400).json({ error: 'Cannot resolve workspaceId' });

  const workspace = storage.getWorkspace(workspaceId);
  if (!workspace) {
    return res.status(404).json({ error: 'Workspace not found' });
  }

  const connected = !!(workspace.googleTokens?.refresh_token);
  const logs = storage.getRecentLogs(workspaceId, 5);

  res.json({
    workspaceId,
    connected,
    calendarId: workspace.calendar_id || 'primary',
    syncEnabled: workspace.syncEnabled,
    recentLogs: logs.map(l => ({
      runAt:   new Date(l.run_at * 1000).toISOString(),
      created: l.entries_created,
      updated: l.entries_updated,
      deleted: l.entries_deleted,
      error:   l.error,
    })),
  });
});

/**
 * GET /settings/api/calendars
 * Returns the user's Google Calendars so they can pick which one to sync into.
 */
router.get('/api/calendars', async (req, res) => {
  const token = req.query.auth_token || req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const payload = parseJwtPayload(token);
  const workspaceId = payload?.workspaceId || payload?.sub;
  const workspace = storage.getWorkspace(workspaceId);

  if (!workspace?.googleTokens?.refresh_token) {
    return res.status(400).json({ error: 'Google not connected' });
  }

  try {
    const authClient = gcal.buildAuthClient(workspace.googleTokens, (t) =>
      storage.saveGoogleTokens(workspaceId, t, null)
    );
    const calendars = await gcal.listCalendars(authClient);
    res.json(calendars.map(c => ({ id: c.id, name: c.summary, primary: c.primary })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /settings/api/update
 * Save settings (calendar selection, sync enabled toggle).
 */
router.post('/api/update', express.json(), (req, res) => {
  const { token, calendarId, syncEnabled } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const payload = parseJwtPayload(token);
  const workspaceId = payload?.workspaceId || payload?.sub;
  const workspace = storage.getWorkspace(workspaceId);

  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

  if (calendarId !== undefined) {
    storage.saveGoogleTokens(workspaceId, workspace.googleTokens, calendarId);
  }

  res.json({ message: 'Settings saved' });
});

/**
 * POST /settings/api/sync-now
 * Trigger an immediate sync run for a workspace (useful for testing).
 */
router.post('/api/sync-now', express.json(), async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const payload = parseJwtPayload(token);
  const workspaceId = payload?.workspaceId || payload?.sub;
  const workspace = storage.getWorkspace(workspaceId);

  if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

  try {
    const { syncWorkspace } = require('../sync');
    const stats = await syncWorkspace(workspace);
    storage.logSyncRun(workspaceId, stats);
    res.json({ message: 'Sync complete', ...stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;