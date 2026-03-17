# Clockify → Google Calendar Sync

A private **Cake.com add-on** for Clockify that automatically syncs time entries to Google Calendar every 15 minutes — creating, updating, and deleting calendar events to stay in perfect alignment.

---

## Features

- **Full two-way sync** for the last 7 days (rolling window)
- **Automatic** — runs every 15 minutes via cron; also triggers on install
- **Smart diffing** — only updates events that actually changed
- **Per-workspace isolation** — each workspace has its own Google account + calendar
- **Calendar picker** — sync into any writable Google Calendar, not just primary
- **Sync log** — view the last 5 runs directly in the settings UI
- **Manual trigger** — "Sync Now" button in settings for immediate runs

## Event Format

Each Clockify time entry becomes a Google Calendar event:

| Clockify Field | Google Calendar Field |
|---|---|
| `[Project] Description` | Event title (summary) |
| `timeInterval.start` | Event start |
| `timeInterval.end` | Event end |
| Project color | Event color (mapped to nearest GCal color) |
| Task name, tags | Event description |

Events are tagged with `extendedProperties.private.clockifySync=true` so the add-on can identify and manage them.

---

## Setup

### 1. Prerequisites

- Node.js 18+
- A [Google Cloud project](https://console.cloud.google.com/) with the **Google Calendar API** enabled
- A [Cake.com developer account](https://developer.marketplace.cake.com/signup)
- A public URL for your server (use [ngrok](https://ngrok.com) for local development)

### 2. Google OAuth Credentials

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (Web application type)
3. Add the following to **Authorized redirect URIs**:
   ```
   https://YOUR_PUBLIC_URL/auth/google/callback
   ```
4. Copy the **Client ID** and **Client Secret**

### 3. Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=8080
BASE_URL=https://your-ngrok-url.ngrok.io

GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret

ADDON_WEBHOOK_SECRET=any_random_string
DB_PATH=./data/addon.db
```

### 4. Install & Run

```bash
npm install
npm start
```

For development with auto-reload:
```bash
npm run dev
```

### 5. Expose Locally with ngrok

```bash
ngrok http 8080
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok.io`) into your `.env` as `BASE_URL`, then restart the server.

### 6. Install as a Cake.com Add-on

1. Log in to your [Cake.com developer account](https://developer.marketplace.cake.com)
2. Go to **Test accounts** → **Login as** (workspace owner)
3. In Clockify: go to **Workspace Settings → Integrations → Add-ons**
4. Paste your manifest URL: `https://YOUR_NGROK_URL/manifest`
5. Install the add-on

### 7. Connect Google Calendar

1. After installing, open the add-on from the Clockify sidebar
2. Click **Connect** next to Google Account
3. Complete the Google OAuth consent flow
4. (Optional) Select a specific target calendar from the dropdown
5. Click **Sync Now** to trigger the first sync immediately

---

## Architecture

```
clockify-gcal-addon/
├── src/
│   ├── index.js          # Express server + manifest endpoint
│   ├── storage.js        # SQLite persistence (workspaces, sync map, logs)
│   ├── clockify.js       # Clockify REST API client
│   ├── gcal.js           # Google Calendar API wrapper
│   ├── sync.js           # Core sync engine + cron scheduler
│   └── routes/
│       ├── lifecycle.js  # /lifecycle/installed + /lifecycle/uninstalled
│       ├── auth.js       # /auth/google  +  /auth/google/callback
│       └── settings.js   # /settings (iframe) + /settings/api/*
├── public/
│   └── settings.html     # Settings UI (rendered inside Clockify iframe)
├── data/                 # Created automatically; holds addon.db
├── .env.example
└── package.json
```

### Sync Flow (every 15 minutes)

```
For each connected workspace:
  1. Fetch Clockify entries  [now-7d, now]   via X-Addon-Token
  2. Load sync_map from SQLite               (clockifyId → gcalEventId + content hash)
  3. Diff:
     - Entry not in map       →  CREATE GCal event, insert map row
     - Entry in map, changed  →  UPDATE GCal event, update hash
     - Map row with no entry  →  DELETE GCal event, remove map row
  4. Log results
```

### Database Schema

| Table | Purpose |
|---|---|
| `workspaces` | One row per installed workspace: addon token, Google tokens, calendar ID |
| `sync_map` | Maps every synced Clockify entry ID ↔ GCal event ID + content hash |
| `sync_log` | Per-run stats for display in the settings UI |

---

## Deployment

For production, deploy to any Node.js host (Railway, Render, Fly.io, etc.) and set `BASE_URL` to your stable public URL. SQLite persists in the `data/` directory — make sure to mount it as a volume if using containerized hosting.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| "Workspace not found" in settings | Re-install the add-on in Clockify |
| Sync not running | Check that Google Calendar is connected in settings |
| Events not appearing | Verify the correct target calendar is selected |
| OAuth error | Ensure redirect URI in Google Cloud matches `BASE_URL/auth/google/callback` |
| Token expired errors | Re-connect Google Calendar in settings |

---

## Notes on the Manifest Format

The Cake.com manifest schema evolves. If Clockify rejects your manifest, check [dev-docs.marketplace.cake.com](https://dev-docs.marketplace.cake.com) for the latest required fields. The manifest is served at `/manifest` in `src/index.js` — easy to update.

## License

MIT
