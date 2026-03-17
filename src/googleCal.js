const { google } = require('googleapis');
const { getDb } = require('./db');

// ─── OAuth helpers ────────────────────────────────────────────────────────────

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Build the Google OAuth consent URL.
 * `state` is a base64url-encoded JSON blob: { workspace_id, user_id }.
 */
function getAuthUrl(state) {
  const oauth2 = createOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',            // force refresh_token to be issued every time
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly'
    ],
    state
  });
}

/** Exchange an authorization code for access + refresh tokens. */
async function exchangeCode(code) {
  const oauth2 = createOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, token_type, scope }
}

// ─── Token management ─────────────────────────────────────────────────────────

/**
 * Retrieve stored Google tokens for a user, refreshing if necessary.
 * Returns null if the user has not connected their Google account.
 */
async function getOrRefreshTokens(workspaceId, userId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM google_tokens WHERE workspace_id = ? AND user_id = ?'
  ).get(workspaceId, userId);

  if (!row) return null;

  const tokens = {
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    expiry_date: row.expiry_date,
    calendar_id: row.calendar_id
  };

  // Refresh if expired or within 60 seconds of expiry
  const isExpiringSoon = tokens.expiry_date && Date.now() >= tokens.expiry_date - 60_000;
  if (isExpiringSoon) {
    const oauth2 = createOAuth2Client();
    oauth2.setCredentials(tokens);
    const { credentials } = await oauth2.refreshAccessToken();

    db.prepare(`
      UPDATE google_tokens
      SET access_token = ?, expiry_date = ?
      WHERE workspace_id = ? AND user_id = ?
    `).run(credentials.access_token, credentials.expiry_date, workspaceId, userId);

    return { ...tokens, access_token: credentials.access_token, expiry_date: credentials.expiry_date };
  }

  return tokens;
}

/** Build a google.calendar client from stored tokens. */
function getCalendarClient(tokens) {
  const oauth2 = createOAuth2Client();
  oauth2.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date
  });
  return google.calendar({ version: 'v3', auth: oauth2 });
}

// ─── Calendar event operations ────────────────────────────────────────────────

/**
 * Build a Google Calendar event resource from a Clockify time entry.
 */
function buildEvent(entry, projectName) {
  const lines = [];
  if (projectName) lines.push(`🗂 Project: ${projectName}`);
  if (entry.billable) lines.push('💰 Billable');
  lines.push(`🔗 Clockify ID: ${entry.id}`);

  return {
    summary: entry.description?.trim() || '(no description)',
    description: lines.join('\n'),
    start: {
      dateTime: entry.timeInterval.start,
      timeZone: 'UTC'
    },
    end: {
      dateTime: entry.timeInterval.end,
      timeZone: 'UTC'
    },
    // Store Clockify ID in private metadata for safe identification
    extendedProperties: {
      private: {
        clockifyId: entry.id,
        clockifySource: 'gcal-sync-addon'
      }
    },
    // Color: sage (2) for billable, graphite (8) for non-billable
    colorId: entry.billable ? '2' : '8'
  };
}

async function createEvent(calendar, calendarId, entry, projectName) {
  if (!entry.timeInterval?.end) return null; // skip in-progress entries

  const { data } = await calendar.events.insert({
    calendarId,
    resource: buildEvent(entry, projectName)
  });
  return data;
}

async function updateEvent(calendar, calendarId, eventId, entry, projectName) {
  if (!entry.timeInterval?.end) return null;

  const { data } = await calendar.events.update({
    calendarId,
    eventId,
    resource: buildEvent(entry, projectName)
  });
  return data;
}

async function deleteEvent(calendar, calendarId, eventId) {
  try {
    await calendar.events.delete({ calendarId, eventId });
    return true;
  } catch (err) {
    // 404 / 410 = already gone, treat as success
    if (err?.code === 404 || err?.code === 410) return true;
    throw err;
  }
}

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  exchangeCode,
  getOrRefreshTokens,
  getCalendarClient,
  createEvent,
  updateEvent,
  deleteEvent
};
