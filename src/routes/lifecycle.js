/**
 * routes/lifecycle.js
 * Handles Cake.com add-on lifecycle webhooks:
 *   POST /lifecycle/installed   — called when a workspace installs the add-on
 *   POST /lifecycle/uninstalled — called when a workspace removes the add-on
 */

const express = require('express');
const router = express.Router();
const storage = require('../storage');

/**
 * POST /lifecycle/installed
 *
 * Cake.com sends:
 * {
 *   "workspaceId": "...",
 *   "userId": "...",        // workspace owner who installed
 *   "addonId": "...",
 *   "clockifyToken": "..."  // installation-level addon token
 * }
 */
router.post('/installed', (req, res) => {
  console.log('[lifecycle] installed payload:', JSON.stringify(req.body));

  const { workspaceId, asUser, authToken } = req.body;

  if (!workspaceId || !asUser || !authToken) {
    console.error('[lifecycle] installed: missing fields', req.body);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    storage.upsertWorkspace({
      workspaceId,
      userId: asUser,
      addonToken: authToken,
    });
    console.log(`[lifecycle] Installed for workspace ${workspaceId}`);
    res.status(200).json({ message: 'ok' });
  } catch (err) {
    console.error('[lifecycle] installed error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * POST /lifecycle/uninstalled
 *
 * Cake.com sends: { "workspaceId": "..." }
 * We remove all stored data for this workspace (cascade deletes sync_map too).
 */
router.post('/uninstalled', (req, res) => {
  console.log('[lifecycle] uninstalled payload:', JSON.stringify(req.body));
  const { workspaceId } = req.body;

  if (!workspaceId) {
    return res.status(400).json({ error: 'Missing workspaceId' });
  }

  try {
    storage.removeWorkspace(workspaceId);
    console.log(`[lifecycle] Uninstalled for workspace ${workspaceId}`);
    res.status(200).json({ message: 'ok' });
  } catch (err) {
    console.error('[lifecycle] uninstalled error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
