const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { syncWorkspaceUser } = require('../sync');

const router = express.Router();

// ─── Auth middleware ──────────────────────────────────────────────────────────

/**
 * Decode the Clockify add-on token that arrives as `auth_token` in the iFrame URL.
 * The token is a JWT whose payload contains `workspaceId` and `user` (userId).
 *
 * We decode without signature verification and use the `sub` claim to confirm
 * the token belongs to our add-on.  For production hardening, verify the signature
 * using the shared secret configured in the CAKE.com Developer Portal.
 */
function requireAddonAuth(req, res, next) {
  // Token arrives as query param from iFrame URL, or in body/header for API calls
  const token =
    req.query.auth_token ||
    req.headers['x-addon-token'] ||
    req.body?.auth_token;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth_token' });
  }

  let payload;
  try {
    payload = jwt.decode(token);
  } catch {
    return res.status(401).json({ error: 'Malformed token' });
  }

  if (!payload?.workspaceId || !payload?.user) {
    return res.status(401).json({ error: 'Invalid token payload' });
  }

  // Optionally enforce add-on key matches
  const expectedKey = process.env.ADDON_KEY;
  if (expectedKey && payload.sub && payload.sub !== expectedKey) {
    return res.status(403).json({ error: 'Token not issued for this add-on' });
  }

  req.workspaceId = payload.workspaceId;
  req.userId      = payload.user;
  req.addonToken  = token;
  next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/status
 * Returns the current connection & configuration state for this user.
 */
router.get('/status', requireAddonAuth, (req, res) => {
  const { workspaceId, userId } = req;
  const db = getDb();

  const gRow = db.prepare(
    'SELECT calendar_id, connected_at FROM google_tokens WHERE workspace_id = ? AND user_id = ?'
  ).get(workspaceId, userId);

  const cfg = db.prepare(
    'SELECT * FROM sync_config WHERE workspace_id = ? AND user_id = ?'
  ).get(workspaceId, userId);

  const count = db.prepare(
    'SELECT COUNT(*) AS n FROM sync_map WHERE workspace_id = ? AND user_id = ?'
  ).get(workspaceId, userId);

  res.json({
    googleConnected: !!gRow,
    calendarId:      gRow?.calendar_id ?? 'primary',
    connectedAt:     gRow?.connected_at ?? null,
    config: {
      daysBack:             cfg?.days_back             ?? 30,
      daysForward:          cfg?.days_forward          ?? 0,
      syncIntervalMinutes:  cfg?.sync_interval_minutes ?? 60,
      enabled:              cfg?.enabled               ?? 1
    },
    syncedEntries: count?.n ?? 0,
    lastSyncAt:    cfg?.last_sync_at ?? null,
    workspaceId,
    userId
  });
});

/**
 * PATCH /api/config
 * Update sync configuration for this user.
 * Body: { daysBack?, daysForward?, enabled? }
 */
router.patch('/config', express.json(), requireAddonAuth, (req, res) => {
  const { workspaceId, userId } = req;
  const { daysBack, daysForward, enabled } = req.body ?? {};
  const db = getDb();

  db.prepare(`
    INSERT INTO sync_config (workspace_id, user_id, days_back, days_forward, enabled)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, user_id) DO UPDATE
      SET days_back    = COALESCE(?, days_back),
          days_forward = COALESCE(?, days_forward),
          enabled      = COALESCE(?, enabled)
  `).run(
    workspaceId, userId,
    daysBack    ?? 30,
    daysForward ?? 0,
    enabled     ?? 1,
    daysBack    !== undefined ? daysBack    : null,
    daysForward !== undefined ? daysForward : null,
    enabled     !== undefined ? enabled     : null
  );

  res.json({ success: true });
});

/**
 * PATCH /api/calendar
 * Update the target Google Calendar ID for this user.
 * Body: { calendarId }
 */
router.patch('/calendar', express.json(), requireAddonAuth, (req, res) => {
  const { workspaceId, userId } = req;
  const { calendarId } = req.body ?? {};
  if (!calendarId) return res.status(400).json({ error: 'Missing calendarId' });

  const db = getDb();
  db.prepare(`
    UPDATE google_tokens SET calendar_id = ? WHERE workspace_id = ? AND user_id = ?
  `).run(calendarId, workspaceId, userId);

  res.json({ success: true });
});

/**
 * POST /api/sync
 * Manually trigger an immediate sync for this user.
 */
router.post('/sync', express.json(), requireAddonAuth, async (req, res) => {
  const { workspaceId, userId } = req;

  try {
    const stats = await syncWorkspaceUser(workspaceId, userId);
    res.json({ success: true, stats });
  } catch (err) {
    console.error('[API] Manual sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
