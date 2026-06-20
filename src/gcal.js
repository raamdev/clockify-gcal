/**
 * gcal.js
 * Google Calendar API wrapper.
 * Handles OAuth2 token refresh and CRUD for calendar events.
 */

const { google } = require('googleapis');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BASE_URL}/auth/google/callback`
  );
}

/**
 * Build an authenticated OAuth2 client from stored tokens.
 * Automatically handles refresh if the access token is expired.
 */
function buildAuthClient(tokens, onTokenRefresh) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials(tokens);

  // Persist refreshed tokens back to DB
  if (onTokenRefresh) {
    oauth2Client.on('tokens', (newTokens) => {
      onTokenRefresh({
        ...tokens,
        ...newTokens,
      });
    });
  }

  return oauth2Client;
}

/**
 * Generate the Google OAuth authorization URL.
 * `state` is passed through to the callback so we can tie the token to a workspace.
 */
function getAuthUrl(state) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token on every auth
    scope: ['https://www.googleapis.com/auth/calendar'],
    state,
  });
}

/**
 * Exchange an authorization code for tokens.
 */
async function exchangeCode(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * List all Google calendars for the user (used in settings to let them pick one).
 */
async function listCalendars(authClient) {
  const calendar = google.calendar({ version: 'v3', auth: authClient });
  const res = await calendar.calendarList.list({ minAccessRole: 'writer' });
  return res.data.items || [];
}

/**
 * Fetch all events in [startISO, endISO] that were created by this add-on.
 * We identify ours via extendedProperties.private.clockifySync = "true".
 */
async function listSyncedEvents(authClient, calendarId, startISO, endISO) {
  const calendar = google.calendar({ version: 'v3', auth: authClient });
  const events = [];
  let pageToken = undefined;

  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin: startISO,
      timeMax: endISO,
      privateExtendedProperty: 'clockifySync=true',
      maxResults: 2500,
      singleEvents: true,
      pageToken,
    });
    events.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return events;
}

/**
 * Build a Google Calendar event resource from a Clockify time entry.
 */
function buildEventResource(entry, projectCache) {
  const project = entry.project || projectCache?.get(entry.projectId);
  const projectName = project?.name || null;

  // Build a meaningful title
  let summary = '';
  if (projectName) summary += `[${projectName}] `;
  if (entry.description) summary += entry.description;
  if (!summary) summary = '(no description)';

  // Build description with metadata
  const lines = [];
  if (entry.task?.name) lines.push(`Task: ${entry.task.name}`);
  if (entry.tags?.length) lines.push(`Tags: ${entry.tags.map(t => t.name).join(', ')}`);
  lines.push(`Synced from Clockify`);
  const description = lines.join('\n');

  // No colorId is set, so events inherit the calendar's color.
  const resource = {
    summary,
    description,
    start: { dateTime: entry.timeInterval.start },
    end:   { dateTime: entry.timeInterval.end   },
    extendedProperties: {
      private: {
        clockifySync: 'true',
        clockifyId:   entry.id,
        clockifyWorkspaceId: entry.workspaceId,
      },
    },
  };

  return resource;
}

async function createEvent(authClient, calendarId, eventResource) {
  const calendar = google.calendar({ version: 'v3', auth: authClient });
  const res = await calendar.events.insert({ calendarId, resource: eventResource });
  return res.data;
}

async function updateEvent(authClient, calendarId, eventId, eventResource) {
  const calendar = google.calendar({ version: 'v3', auth: authClient });
  const res = await calendar.events.update({ calendarId, eventId, resource: eventResource });
  return res.data;
}

async function deleteEvent(authClient, calendarId, eventId) {
  const calendar = google.calendar({ version: 'v3', auth: authClient });
  await calendar.events.delete({ calendarId, eventId });
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  buildAuthClient,
  listCalendars,
  listSyncedEvents,
  buildEventResource,
  createEvent,
  updateEvent,
  deleteEvent,
};
