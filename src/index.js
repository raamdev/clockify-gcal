/**
 * index.js
 * Entry point — Express server + manifest + sync scheduler.
 */

require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Allow iframes from Clockify domains
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOW-FROM https://clockify.me https://app.clockify.me');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.clockify.me https://*.cake.com");
  next();
});

// ── Manifest ──────────────────────────────────────────────────────────────────
// Clockify fetches this URL when an admin installs the add-on.
// Adjust the structure as needed when Cake.com updates their manifest schema.

app.get('/manifest', (req, res) => {
  res.json({
    id: 'clockify-gcal-sync',
    name: 'Google Calendar Sync',
    description: 'Automatically syncs Clockify time entries to Google Calendar every 15 minutes — creates, updates, and deletes events to keep both tools in perfect alignment.',
    version: '1.0.0',
    baseUrl: BASE_URL,

    // Where the settings iframe is rendered inside Clockify
    settings: {
      url: `${BASE_URL}/settings`,
    },

    // Add-on lifecycle hooks
    lifecycle: {
      installed:   `${BASE_URL}/lifecycle/installed`,
      uninstalled: `${BASE_URL}/lifecycle/uninstalled`,
    },

    // UI component: a tab in workspace settings / integrations
    components: [
      {
        type: 'SIDEBAR',
        url:  `${BASE_URL}/settings`,
        label: 'GCal Sync',
      },
    ],

    // Required Clockify scopes
    scopes: ['TIME_ENTRIES:READ', 'WORKSPACE:READ', 'USER:READ'],
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/lifecycle', require('./routes/lifecycle'));
app.use('/auth',      require('./routes/auth'));
app.use('/settings',  require('./routes/settings'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🗓  Clockify → Google Calendar Sync add-on`);
  console.log(`   Server: http://localhost:${PORT}`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Manifest: ${BASE_URL}/manifest\n`);

  // Start the 15-minute sync scheduler
  require('./sync').startScheduler();
});
