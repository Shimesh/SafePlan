/**
 * govmapService.js
 *
 * Fetches public bomb-shelter data from GovMap Layer 417 and converts the
 * Israeli ITM coordinates to WGS84 before returning them to callers.
 *
 * GovMap Layer 417 = public bomb shelters / safe-rooms registered with the
 * Israeli Home Front Command. The API returns features with ITM x/y geometry.
 *
 * Caching strategy: shelters are physical buildings that rarely change.
 * We cache the converted list in memory for 1 hour to avoid hammering GovMap
 * and to provide instant responses during emergencies when latency matters.
 */

'use strict';

const axios = require('axios');
const { itmToWgs84 } = require('../utils/coordinateConverter');

// ─── In-memory cache ───────────────────────────────────────────────────────
let _cache = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── GovMap WFS request parameters ────────────────────────────────────────
// GovMap exposes a WFS-like JSON endpoint. The exact shape was reverse-
// engineered from browser network traffic on govmap.gov.il with Layer 417.
// If the endpoint changes, update GOVMAP_WFS_URL in .env.
const GOVMAP_BASE = process.env.GOVMAP_WFS_URL || 'https://www.govmap.gov.il/govmap/api/layers/data';
const LAYER_ID    = process.env.GOVMAP_LAYER_ID || '417';

// Axios instance with conservative timeouts and a browser-like User-Agent
// to reduce the chance of receiving a bot-block response.
const govmapClient = axios.create({
  baseURL: GOVMAP_BASE,
  timeout: 15_000,
  headers: {
    'User-Agent': 'SafeRoute-Israel/1.0 (emergency navigation; contact: safeplandev@example.com)',
    Accept: 'application/json',
    Referer: 'https://www.govmap.gov.il/',
  },
});

/**
 * Parse a raw GovMap feature into a clean shelter object with WGS84 coords.
 *
 * @param {object} feature – raw feature from GovMap JSON response
 * @param {number} index   – array position (fallback ID)
 * @returns {object|null}   shelter record, or null if coordinates are missing
 */
function parseFeature(feature, index) {
  try {
    // GovMap returns geometry as { x, y } in ITM, or nested under .geometry
    const x = feature.x ?? feature.geometry?.x ?? feature.POINT_X;
    const y = feature.y ?? feature.geometry?.y ?? feature.POINT_Y;

    if (x == null || y == null) {
      console.warn(`[govmapService] Feature ${index} missing coordinates, skipping.`);
      return null;
    }

    const { lat, lng } = itmToWgs84(Number(x), Number(y));

    return {
      id:       String(feature.id ?? feature.OBJECTID ?? index),
      name:     feature.name ?? feature.NAME ?? feature.shem ?? `Shelter ${index}`,
      address:  feature.address ?? feature.RECHOV ?? feature.ktovet ?? null,
      capacity: Number(feature.capacity ?? feature.TZEVA ?? 0) || null,
      type:     feature.type ?? feature.SUG ?? 'public', // public | private | municipal
      lat,
      lng,
    };
  } catch (err) {
    console.error(`[govmapService] Failed to parse feature ${index}:`, err.message);
    return null;
  }
}

/**
 * Fetch shelters from GovMap Layer 417.
 * Returns a cached list if the TTL has not expired.
 *
 * @returns {Promise<Array>} Array of shelter objects with WGS84 lat/lng
 */
async function fetchShelters() {
  const now = Date.now();

  // Serve from cache if still fresh
  if (_cache && now - _cacheTimestamp < CACHE_TTL_MS) {
    console.log(`[govmapService] Returning ${_cache.length} shelters from cache.`);
    return _cache;
  }

  console.log('[govmapService] Cache miss – fetching from GovMap...');

  let features = [];

  try {
    // GovMap WFS-style query: request all features from layer 417
    const response = await govmapClient.get('', {
      params: {
        layerId:  LAYER_ID,
        // GovMap sometimes paginates; request a large page to get all shelters
        // in one shot. In production you may need to paginate with startIndex.
        resultRecordCount: 5000,
      },
    });

    const data = response.data;

    // GovMap may wrap the array under different keys depending on version
    features = data.features ?? data.data ?? data.results ?? data ?? [];

    if (!Array.isArray(features)) {
      throw new Error(`Unexpected GovMap response shape: ${JSON.stringify(data).slice(0, 200)}`);
    }
  } catch (err) {
    // If the live API fails, fall back to bundled mock data so the app
    // remains functional during development or API outages.
    console.error('[govmapService] GovMap request failed:', err.message);
    console.warn('[govmapService] Falling back to mock shelter data.');
    return getFallbackShelters();
  }

  const shelters = features
    .map((f, i) => parseFeature(f, i))
    .filter(Boolean); // remove nulls from failed parses

  console.log(`[govmapService] Fetched and converted ${shelters.length} shelters.`);

  // Update cache
  _cache = shelters;
  _cacheTimestamp = now;

  return shelters;
}

/**
 * Invalidate the cache (call after manual data refresh or for testing).
 */
function invalidateCache() {
  _cache = null;
  _cacheTimestamp = 0;
}

/**
 * Fallback shelter data (hardcoded WGS84) used when GovMap is unreachable.
 * These are real public shelters in the central Israel / Sharon region,
 * useful for development and the Rosh HaAyin → Sharon mock scenario.
 */
function getFallbackShelters() {
  return [
    { id: 'fb-001', name: 'מקלט ציבורי – רחוב הרצל, ראש העין', address: 'רחוב הרצל 12, ראש העין', capacity: 60, type: 'public', lat: 32.0956, lng: 34.9574 },
    { id: 'fb-002', name: 'מקלט ציבורי – כפר סבא מרכז', address: 'רחוב ויצמן 5, כפר סבא', capacity: 80, type: 'public', lat: 32.1750, lng: 34.9020 },
    { id: 'fb-003', name: 'מקלט – גני תקווה', address: 'שדרות ירושלים 3, גני תקווה', capacity: 30, type: 'public', lat: 32.0610, lng: 34.8780 },
    { id: 'fb-004', name: 'מקלט עירוני – הוד השרון', address: 'רחוב הבנים 7, הוד השרון', capacity: 100, type: 'municipal', lat: 32.1526, lng: 34.9067 },
    { id: 'fb-005', name: 'מקלט – רעננה צפון', address: 'רחוב אחוזה 45, רעננה', capacity: 50, type: 'public', lat: 32.1846, lng: 34.8706 },
    { id: 'fb-006', name: 'מקלט – פתח תקווה מזרח', address: 'רחוב חובבי ציון 8, פתח תקווה', capacity: 70, type: 'public', lat: 32.0883, lng: 34.9036 },
  ];
}

module.exports = { fetchShelters, invalidateCache };
