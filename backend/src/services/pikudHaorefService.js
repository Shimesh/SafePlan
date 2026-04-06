/**
 * pikudHaorefService.js
 *
 * Polls the Pikud HaOref (Home Front Command) public alert feed every
 * POLL_INTERVAL_MS milliseconds and emits a Socket.io 'alert' event to all
 * connected mobile clients whenever a new alert is detected.
 *
 * API note: The oref.org.il endpoint is public but unofficial. It returns:
 *  - An empty string ("") or empty object when there is no active alert
 *  - A JSON object with `id`, `cat`, `title`, `data` (array of region strings)
 *    when an alert is live
 *
 * Threat-origin mapping: The alert `cat` (category) field is mapped to a
 * human-readable threat origin (displayed on the EmergencyBanner in the app).
 *
 * Time-to-impact mapping: Israel's Home Front Command publishes official
 * response times per region type. We use a conservative lookup table here;
 * production code should use the official polygon-based lookup.
 */

'use strict';

const axios = require('axios');

// Polling URL (can be overridden via .env for testing with a local mock)
const ALERT_URL = process.env.PIKUD_HAOREF_URL ||
  'https://www.oref.org.il/WarningMessages/alert/alerts.json';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 2000;

// Axios instance – the oref endpoint is finicky; it requires specific headers
// otherwise it returns 403 or an HTML error page.
const orefClient = axios.create({
  timeout: 8000,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://www.oref.org.il/',
    'User-Agent':
      'Mozilla/5.0 (SafeRoute-Israel emergency navigation app)',
    Accept: 'application/json, text/plain, */*',
  },
  // The endpoint returns text/html content-type even for JSON; force parsing
  transformResponse: [
    (data) => {
      if (!data || data.trim() === '') return null;
      try { return JSON.parse(data); } catch { return null; }
    },
  ],
});

// ─── Threat-origin lookup by alert category ────────────────────────────────
// Source: Pikud HaOref published category codes (cat field in alert JSON)
const THREAT_ORIGIN_MAP = {
  1:   'Gaza',        // Rockets / missiles – Gaza
  2:   'Lebanon',     // Rockets – Lebanon / Hezbollah
  3:   'Syria',       // Rockets – Syria
  4:   'Iran',        // Ballistic missiles – Iran
  5:   'Yemen',       // Ballistic missiles – Houthi / Yemen
  6:   'West Bank',   // West Bank / Judea & Samaria
  7:   'Iraq',        // Iraq
  8:   'Hostile aircraft infiltration',
  9:   'Earthquake',
  10:  'Radioactive material',
  11:  'Tsunami',
  12:  'Hazardous material',
  13:  'Unconventional threat',
  14:  'Terror attack',
  15:  'General alert',
  20:  'Lebanon',     // Drone attack – Lebanon
  101: 'Gaza',        // Short-range rockets (Gaza border)
  102: 'Gaza',        // Mortar fire (Gaza border)
  103: 'Gaza',        // Anti-tank fire
};

// ─── Time-to-impact lookup (seconds) by region type ───────────────────────
// Production: use the official HFC polygon service. These are HFC published
// minimum times for illustrative purposes.
const TIME_TO_IMPACT_BY_REGION = {
  'גוש דן':     90,   // Tel Aviv metro area
  'שרון':       90,
  'ירושלים':   90,
  'שפלה':      45,
  'עוטף עזה':  10,   // Gaza border communities – 10 seconds
  'default':    90,
};

// ─── State ─────────────────────────────────────────────────────────────────
let _lastAlertId  = null;
let _pollInterval = null;
let _ioInstance   = null;

/**
 * Map region strings to the minimum time-to-impact across all alert regions.
 */
function resolveTimeToImpact(regions = []) {
  let min = TIME_TO_IMPACT_BY_REGION.default;
  for (const region of regions) {
    const t = TIME_TO_IMPACT_BY_REGION[region];
    if (t != null && t < min) min = t;
  }
  return min;
}

/**
 * Map alert category number to a human-readable threat origin label.
 */
function resolveThreatOrigin(cat, title) {
  if (THREAT_ORIGIN_MAP[cat]) return THREAT_ORIGIN_MAP[cat];
  // Fallback: derive origin from the Hebrew alert title if category is unmapped
  if (title) {
    if (/איראן/.test(title))  return 'Iran';
    if (/לבנון/.test(title))  return 'Lebanon';
    if (/עזה/.test(title))    return 'Gaza';
    if (/תימן/.test(title))   return 'Yemen';
    if (/סוריה/.test(title))  return 'Syria';
    if (/עיראק/.test(title))  return 'Iraq';
    return title; // return the Hebrew title verbatim as the origin label
  }
  return 'ירי רקטות'; // default Hebrew label instead of 'Unknown'
}

/**
 * Fetch the current Pikud HaOref alert (if any).
 * Returns null when there is no active alert.
 *
 * @returns {Promise<object|null>}
 */
async function fetchCurrentAlert() {
  try {
    const response = await orefClient.get(ALERT_URL);
    const data = response.data;

    // No active alert → endpoint returns null, empty string, or empty object
    if (!data || !data.id) return null;

    return data;
  } catch (err) {
    // Network errors should not crash the polling loop
    if (err.response?.status === 429) {
      console.warn('[pikudHaoref] Rate-limited (429). Backing off…');
    } else {
      console.error('[pikudHaoref] Fetch error:', err.message);
    }
    return null;
  }
}

/**
 * Process a raw alert from the oref API and emit it to Socket.io clients.
 *
 * @param {object} rawAlert – the parsed JSON from oref
 * @param {object} io       – Socket.io server instance
 */
function processAndEmitAlert(rawAlert, io) {
  const alertId = String(rawAlert.id);

  // Deduplicate: only emit if this is a new alert we haven't seen before
  if (alertId === _lastAlertId) return;
  _lastAlertId = alertId;

  const regions      = rawAlert.data || [];   // array of region name strings
  const threatOrigin = resolveThreatOrigin(rawAlert.cat, rawAlert.title);
  const timeToImpact = resolveTimeToImpact(regions);

  const alertPayload = {
    id:           alertId,
    title:        rawAlert.title || 'ירי רקטות',
    threatOrigin,
    regions,
    timeToImpact, // seconds until impact
    category:     rawAlert.cat,
    timestamp:    new Date().toISOString(),
  };

  console.log(
    `[pikudHaoref] 🚨 NEW ALERT: ${threatOrigin} | regions: ${regions.join(', ')} | ` +
    `timeToImpact: ${timeToImpact}s`
  );

  // Broadcast to every connected Socket.io client
  io.emit('alert', alertPayload);
}

/**
 * Start polling the Pikud HaOref API.
 *
 * @param {object} io – Socket.io server instance (must be set before calling)
 */
function startPolling(io) {
  if (!io) throw new Error('[pikudHaoref] startPolling requires a Socket.io instance');
  _ioInstance = io;

  console.log(`[pikudHaoref] Starting alert polling every ${POLL_INTERVAL_MS}ms…`);

  _pollInterval = setInterval(async () => {
    const rawAlert = await fetchCurrentAlert();
    if (rawAlert) processAndEmitAlert(rawAlert, _ioInstance);
  }, POLL_INTERVAL_MS);

  // Also poll once immediately on startup
  fetchCurrentAlert().then((a) => {
    if (a) processAndEmitAlert(a, _ioInstance);
  });
}

/**
 * Stop the polling loop (useful for graceful shutdown / tests).
 */
function stopPolling() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
    console.log('[pikudHaoref] Polling stopped.');
  }
}

/**
 * Inject a mock alert directly (for testing / demo without real API).
 * Bypasses processAndEmitAlert() and emits the payload directly so that
 * the caller-supplied threatOrigin and timeToImpact are honoured exactly.
 *
 * @param {object} io
 * @param {string} threatOrigin – e.g. 'Iran', 'Gaza', 'Yemen'
 * @param {number} timeToImpact – seconds until impact
 */
function injectMockAlert(io, threatOrigin = 'Iran', timeToImpact = 90) {
  const id = `mock-${Date.now()}`;

  const alertPayload = {
    id,
    title:        'ירי רקטות ופגזים',
    threatOrigin, // use caller value directly — not a cat→name lookup
    regions:      ['שרון', 'גוש דן'],
    timeToImpact, // use caller value directly — not a region-based lookup
    category:     4,
    timestamp:    new Date().toISOString(),
  };

  console.log(
    `[pikudHaoref] 🚨 MOCK ALERT: ${threatOrigin} | timeToImpact: ${timeToImpact}s`
  );

  // Reset dedup state so the next real alert is never suppressed
  _lastAlertId = id;

  io.emit('alert', alertPayload);
}

module.exports = { startPolling, stopPolling, injectMockAlert, fetchCurrentAlert };
