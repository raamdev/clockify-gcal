/**
 * routes/auth.js
 * Google OAuth 2.0 flow for connecting a workspace to Google Calendar.
 *
 * Flow:
 *   1. Settings iframe calls GET /auth/google?workspaceId=...
 *   2. User is redirected to Google consent screen
 *   3. Google redirects back to GET /auth/google/callback?code=...&state=...
 *   4. We exchange code for tokens, save them, redirect user to success page
 */

const express = require('express');
const router = express.Router();
const gcal = require('../gcal');
const storage = require('../storage');

/**
 * GET /auth/google
 * Initiate OAuth flow. `workspaceId` is passed as `state` so we can
 * tie the resulting tokens to the right workspace.
 */
router.get('/google', (req, res) => {
  const { workspaceId } = req.query;

  if (!workspaceId) {
    return res.status(400).send('Missing workspaceId');
  }

  // Verify the workspace is installed
  const workspace = storage.getWorkspace(workspaceId);
  if (!workspace) {
    return res.status(404).send('Workspace not found. Please reinstall the add-on.');
  }

  const authUrl = gcal.getAuthUrl(workspaceId);
  res.redirect(authUrl);
});

/**
 * GET /auth/google/callback
 * Google redirects here after the user grants access.
 */
router.get('/google/callback', async (req, res) => {
  const { code, state: workspaceId, error } = req.query;

  if (error) {
    return res.status(400).send(`Google auth error: ${error}`);
  }

  if (!code || !workspaceId) {
    return res.status(400).send('Missing code or state');
  }

  try {
    const tokens = await gcal.exchangeCode(code);
    storage.saveGoogleTokens(workspaceId, tokens, 'primary');

    console.log(`[auth] Google connected for workspace ${workspaceId}`);

    // Close the popup / redirect back to settings
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connected!</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center;
                 justify-content: center; height: 100vh; margin: 0;
                 background: #0f1117; color: #e2e8f0; }
          .card { text-align: center; padding: 2rem; }
          .icon { font-size: 3rem; }
          h2 { margin: 1rem 0 0.5rem; }
          p { color: #94a3b8; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h2>Google Calendar Connected!</h2>
          <p>You can close this tab and return to Clockify.</p>
          <script>
            // If opened as a popup, close it
            if (window.opener) {
              window.opener.postMessage({ type: 'gcal-connected', workspaceId: '${workspaceId}' }, '*');
              window.close();
            }
          </script>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[auth] Google callback error:', err);
    res.status(500).send(`Failed to exchange token: ${err.message}`);
  }
});

/**
 * POST /auth/google/disconnect
 * Remove Google tokens for a workspace (user-initiated).
 */
router.post('/google/disconnect', express.json(), (req, res) => {
  const { workspaceId } = req.body;
  if (!workspaceId) return res.status(400).json({ error: 'Missing workspaceId' });

  storage.saveGoogleTokens(workspaceId, null, null);
  res.json({ message: 'Disconnected' });
});

module.exports = router;
