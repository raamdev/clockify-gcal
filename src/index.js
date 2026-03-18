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
    schemaVersion: '1.3',
    key: 'clockify-gcal-sync',
    name: 'Clockify-Gcal',
    description: 'Automatically syncs Clockify time entries to Google Calendar every 15 minutes.',
    version: '1.0.0',
    baseUrl: BASE_URL,
    minimalSubscriptionPlan:"FREE",

    scopes: ['TIME_ENTRY_READ', 'PROJECT_READ', 'USER_READ'],

    lifecycles: [
      { type: 'INSTALLED', path: '/lifecycle/installed' },
      { type: 'DELETED',   path: '/lifecycle/uninstalled' },
    ],

    components: [
      {
        type: 'sidebar',
        label: 'GCal Sync',
        accessLevel: 'ADMINS',
        path: '/settings',
      },
    ],
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
