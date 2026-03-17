require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const path = require('path');

const { initDb } = require('./src/db');
const { startScheduler } = require('./src/scheduler');
const lifecycleRoutes = require('./src/routes/lifecycle');
const authRoutes = require('./src/routes/auth');
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow iFraming from Clockify
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use('/ui', express.static(path.join(__dirname, 'ui')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ─── Manifest ─────────────────────────────────────────────────────────────────
// Served dynamically so BASE_URL is always correct
app.get('/manifest.json', (req, res) => {
  const manifest = {
    key: process.env.ADDON_KEY || 'clockify-gcal-sync',
    name: 'Google Calendar Sync',
    baseUrl: BASE_URL,
    components: [
      {
        type: 'sidebar',
        label: 'GCal Sync',
        accessLevel: 'EVERYONE',
        path: '/ui/settings.html',
        iconPath: '/assets/icon.svg'
      }
    ],
    lifecycles: {
      installed: '/lifecycle/installed',
      uninstalled: '/lifecycle/uninstalled'
    }
  };
  res.json(manifest);
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/lifecycle', lifecycleRoutes);
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
initDb();
startScheduler();

app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║   Clockify → GCal Sync Add-on             ║`);
  console.log(`╠═══════════════════════════════════════════╣`);
  console.log(`║  Server:   ${BASE_URL.padEnd(31)}║`);
  console.log(`║  Manifest: ${(BASE_URL + '/manifest.json').padEnd(31)}║`);
  console.log(`╚═══════════════════════════════════════════╝\n`);
});
