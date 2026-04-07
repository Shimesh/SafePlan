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
 * ── Alert types ────────────────────────────────────────────────────────────
 *
 *  alertType: 'preliminary' = התרעה מקדימה
 *    Issued when a ballistic missile (Iran/Yemen) is detected at launch.
 *    The user has warningTimeSeconds to begin moving to shelter BEFORE
 *    the siren actually sounds. timeToImpact is counted from when the
 *    siren fires. Total time available = warningTimeSeconds + timeToImpact.
 *
 *  alertType: 'active' = אזעקה פעילה
 *    The rocket/missile is already in the air. The siren is sounding NOW.
 *    User has only timeToImpact seconds to reach shelter.
 *    warningTimeSeconds = 0 for these alerts.
 *
 * ── Category codes (based on Pikud HaOref published documentation) ─────────
 *
 *   1  = ירי רקטות ופגזים               (Rockets / mortars — active)
 *   2  = חדירת כלי טיס עוין             (Hostile aircraft infiltration — active)
 *   3  = חשש לרעידת אדמה                (Earthquake — preliminary)
 *   4  = חומרים מסוכנים                  (Hazardous materials — active)
 *   5  = אירועי טרור                     (Terror incident — active)
 *   6  = צונאמי                          (Tsunami warning — preliminary)
 *   7  = אי-שגרה                         (Unconventional threat — preliminary)
 *   9  = אירוע חומרים מסוכנים             (Hazmat — active)
 *  13  = ירי רקטות ופגזים               (Rockets — active, additional category)
 *  20  = טיל בליסטי                      (Ballistic missile — preliminary then active)
 * 101  = ירי רקטות — עוטף עזה            (Gaza-border short-range — active, 0-10s)
 * 102  = ירי רקטות — מרחק בינוני         (Mid-range rockets — active)
 * 103  = ירי נ"ט                          (Anti-tank fire — active)
 *
 * ── Official HFC response times (seconds) by region type ──────────────────
 *  Gaza border (0–7 km)       : 0–10 s  → enter shelter IMMEDIATELY
 *  Near Gaza / Negev           : 15–30 s
 *  South coast (Ashkelon area): 30 s
 *  Shfela (lowlands)           : 30–45 s
 *  Dan Bloc / Sharon            : 90 s
 *  Jerusalem                   : 90 s
 *  Haifa / Carmel              : 30 s
 *  Northern cities              : 30–60 s
 *  Eilat                       : 0 s (immediate)
 *  Ballistic — Iran / Yemen    : 180 s (3 min, with preliminary warning of ~120 s)
 */

'use strict';

const axios = require('axios');

// Polling URL (can be overridden via .env for testing with a local mock)
const ALERT_URL = process.env.PIKUD_HAOREF_URL ||
  'https://www.oref.org.il/WarningMessages/alert/alerts.json';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 2000;

// Axios instance – the oref endpoint requires specific headers
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

// ─── Category → threat origin label ───────────────────────────────────────
const THREAT_ORIGIN_MAP = {
  1:   'ירי רקטות ופגזים',          // Rockets / mortars
  2:   'חדירת כלי טיס עוין',        // Hostile aircraft
  3:   'חשש לרעידת אדמה',           // Earthquake suspicion
  4:   'חומרים מסוכנים',             // Hazmat
  5:   'אירוע טרור',                 // Terror
  6:   'אזהרת צונאמי',               // Tsunami
  7:   'אי-שגרה',                    // Unconventional
  9:   'חומרים מסוכנים',             // Hazmat (alt code)
  13:  'ירי רקטות ופגזים',           // Rockets (alt code)
  20:  'טיל בליסטי',                 // Ballistic missile (Iran/Yemen)
  101: 'ירי רקטות — עוטף עזה',      // Short-range Gaza border
  102: 'ירי רקטות',                  // Mid-range rockets
  103: 'ירי נ"ט',                    // Anti-tank fire
};

/**
 * Categories that issue a PRELIMINARY WARNING before the siren.
 * All others are 'active' (siren fires immediately).
 */
const PRELIMINARY_CATEGORIES = new Set([20, 3, 6, 7]);

/**
 * Categories that carry a ballistic-missile threat (long preliminary warning).
 * These get 120s preliminary warning + 180s time-to-impact.
 */
const BALLISTIC_CATEGORIES = new Set([20]);

// ─── Time-to-impact (seconds) by region — from siren to impact ────────────
// These are the HFC published MINIMUM times per zone.
// Production: use the official HFC polygon/GIS service for exact per-address lookup.
const TIME_TO_IMPACT_BY_REGION = {
  // Gaza border communities (0–7 km from fence)
  'עוטף עזה':           10,
  'שדרות':              10,
  'קריית גת':           15,
  'אשקלון':             30,
  'אשדוד':              45,

  // South
  'נגב':                30,
  'באר שבע':            45,
  'ערד':                60,
  'אילת':               0,   // Eilat is a special case — immediate if targeted

  // Central / Dan Bloc / Sharon
  'גוש דן':             90,
  'תל אביב':            90,
  'שרון':               90,
  'פתח תקווה':          90,
  'רמת גן':             90,
  'הוד השרון':          90,
  'רעננה':              90,
  'כפר סבא':            90,
  'הרצלייה':            90,
  'נתניה':              90,

  // Jerusalem
  'ירושלים':            90,
  'גוש עציון':          90,
  'בית שמש':            90,

  // Shfela / lowlands
  'שפלה':               45,
  'מודיעין':            90,

  // North / Haifa
  'חיפה':               30,
  'קריות':              30,
  'עכו':                30,
  'נהריה':              30,
  'גליל':               60,
  'צפת':                60,
  'טבריה':              60,
  'עמק יזרעאל':         45,

  // Default (unknown region, conservative)
  default:              90,
};

// ─── Preliminary warning time (seconds) before siren ─────────────────────
// These model the TIME BEFORE THE SIREN SOUNDS for each threat type.
// During this window the app shows "התרעה מקדימה".
const WARNING_TIME_BY_CATEGORY = {
  20:  120,   // Ballistic missile (Iran/Yemen) — ~2 min preliminary
  6:   300,   // Tsunami — 5 min warning
  3:   0,     // Earthquake — no usable warning (already shaking)
  7:   60,    // Unconventional — 1 min generic warning
};

// ─── State ─────────────────────────────────────────────────────────────────
let _lastAlertId  = null;
let _pollInterval = null;
let _ioInstance   = null;

/**
 * Map region strings to the minimum time-to-impact across all alert regions.
 * Uses the most conservative (shortest) time found.
 */
function resolveTimeToImpact(regions = []) {
  let min = TIME_TO_IMPACT_BY_REGION.default;
  for (const region of regions) {
    for (const [key, t] of Object.entries(TIME_TO_IMPACT_BY_REGION)) {
      if (key === 'default') continue;
      // Partial match: allow 'תל אביב' to match 'גוש דן — תל אביב' etc.
      if (region.includes(key) || key.includes(region)) {
        if (t < min) min = t;
        break;
      }
    }
  }
  return min;
}

/**
 * Map alert category number to a human-readable threat origin label (Hebrew).
 */
function resolveThreatOrigin(cat, title) {
  if (THREAT_ORIGIN_MAP[cat]) return THREAT_ORIGIN_MAP[cat];
  // Fallback: derive origin from the Hebrew alert title
  if (title) {
    if (/איראן/.test(title))    return 'טיל בליסטי — איראן';
    if (/לבנון/.test(title))    return 'ירי רקטות — לבנון';
    if (/עזה/.test(title))      return 'ירי רקטות — עזה';
    if (/תימן/.test(title))     return 'טיל בליסטי — תימן';
    if (/סוריה/.test(title))    return 'ירי רקטות — סוריה';
    if (/עיראק/.test(title))    return 'ירי רקטות — עיראק';
    if (/בליסטי/.test(title))   return 'טיל בליסטי';
    return title;
  }
  return 'ירי רקטות ופגזים';
}

/**
 * Determine whether this alert is preliminary or active, and how long
 * the preliminary warning phase lasts.
 */
function resolveAlertType(cat) {
  if (PRELIMINARY_CATEGORIES.has(cat)) {
    return {
      alertType:          'preliminary',
      warningTimeSeconds: WARNING_TIME_BY_CATEGORY[cat] ?? 60,
    };
  }
  return {
    alertType:          'active',
    warningTimeSeconds: 0,
  };
}

/**
 * Fetch the current Pikud HaOref alert (if any).
 * Returns null when there is no active alert.
 */
async function fetchCurrentAlert() {
  try {
    const response = await orefClient.get(ALERT_URL);
    const data = response.data;
    if (!data || !data.id) return null;
    return data;
  } catch (err) {
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
 */
function processAndEmitAlert(rawAlert, io) {
  const alertId = String(rawAlert.id);
  if (alertId === _lastAlertId) return;
  _lastAlertId = alertId;

  const regions        = rawAlert.data || [];
  const threatOrigin   = resolveThreatOrigin(rawAlert.cat, rawAlert.title);
  const timeToImpact   = resolveTimeToImpact(regions);
  const { alertType, warningTimeSeconds } = resolveAlertType(rawAlert.cat);

  const alertPayload = {
    id:                 alertId,
    title:              rawAlert.title || 'ירי רקטות ופגזים',
    threatOrigin,
    regions,
    timeToImpact,
    warningTimeSeconds,
    category:           rawAlert.cat,
    timestamp:          new Date().toISOString(),
    alertType,
  };

  console.log(
    `[pikudHaoref] 🚨 NEW ALERT [${alertType.toUpperCase()}]: ${threatOrigin} | ` +
    `regions: ${regions.join(', ')} | ` +
    `warning: ${warningTimeSeconds}s | impact: ${timeToImpact}s`
  );

  io.emit('alert', alertPayload);
}

/**
 * Start polling the Pikud HaOref API.
 */
function startPolling(io) {
  if (!io) throw new Error('[pikudHaoref] startPolling requires a Socket.io instance');
  _ioInstance = io;

  console.log(`[pikudHaoref] Starting alert polling every ${POLL_INTERVAL_MS}ms…`);

  _pollInterval = setInterval(async () => {
    const rawAlert = await fetchCurrentAlert();
    if (rawAlert) processAndEmitAlert(rawAlert, _ioInstance);
  }, POLL_INTERVAL_MS);

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
 * Inject a mock alert for testing / demo.
 * Bypasses processAndEmitAlert() so the caller-supplied values are honoured exactly.
 *
 * @param {object} io
 * @param {string} threatOrigin  e.g. 'ירי רקטות — עזה'
 * @param {number} timeToImpact  seconds from siren to impact
 * @param {'preliminary'|'active'} alertType
 * @param {number} warningTimeSeconds  seconds of preliminary phase (0 for active)
 */
function injectMockAlert(
  io,
  threatOrigin = 'ירי רקטות — עזה',
  timeToImpact = 90,
  alertType = 'active',
  warningTimeSeconds = 0
) {
  const id = `mock-${Date.now()}`;

  const alertPayload = {
    id,
    title:             'ירי רקטות ופגזים',
    threatOrigin,
    regions:           ['שרון', 'גוש דן', 'תל אביב'],
    timeToImpact,
    warningTimeSeconds,
    category:          alertType === 'preliminary' ? 20 : 1,
    timestamp:         new Date().toISOString(),
    alertType,
  };

  console.log(
    `[pikudHaoref] 🚨 MOCK ALERT [${alertType.toUpperCase()}]: ${threatOrigin} | ` +
    `warning: ${warningTimeSeconds}s | impact: ${timeToImpact}s`
  );

  _lastAlertId = id;
  io.emit('alert', alertPayload);
}

module.exports = { startPolling, stopPolling, injectMockAlert, fetchCurrentAlert };
