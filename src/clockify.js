/**
 * clockify.js
 * Thin wrapper around the Clockify REST API.
 * Uses X-Addon-Token for background sync calls (no user session needed).
 */

const axios = require('axios');

const BASE_URL = 'https://api.clockify.me/api/v1';

function client(addonToken) {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'X-Addon-Token': addonToken,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Fetch the user record associated with the addon token.
 * Useful for resolving userId when we only have workspaceId.
 */
async function getUser(addonToken) {
  const res = await client(addonToken).get('/user');
  return res.data;
}

/**
 * Fetch all time entries for a user in a given time window.
 * Handles pagination automatically (Clockify max page size = 500).
 */
async function getTimeEntries(addonToken, workspaceId, userId, startISO, endISO) {
  const entries = [];
  let page = 1;
  const pageSize = 500;

  while (true) {
    const res = await client(addonToken).get(
      `/workspaces/${workspaceId}/user/${userId}/time-entries`,
      {
        params: {
          start: startISO,
          end: endISO,
          'page-size': pageSize,
          page,
          'hydrated': true, // includes project/task details inline
        },
      }
    );

    const batch = res.data;
    entries.push(...batch);

    // Stop if this is the last page
    const lastPage = res.headers['last-page'];
    if (lastPage === 'true' || batch.length < pageSize) break;
    page++;
  }

  return entries;
}

/**
 * Fetch project details (name, color) — cached by the caller.
 */
async function getProject(addonToken, workspaceId, projectId) {
  const res = await client(addonToken).get(
    `/workspaces/${workspaceId}/projects/${projectId}`
  );
  return res.data;
}

module.exports = { getUser, getTimeEntries, getProject };
