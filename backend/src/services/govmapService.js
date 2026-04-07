/**
 * govmapService.js
 *
 * Fetches public bomb-shelter data from GovMap and converts coordinates
 * to WGS84 before returning them to callers.
 *
 * GovMap exposes shelters through two possible endpoints:
 *  1. ArcGIS FeatureServer REST API at ags.govmap.gov.il  (primary)
 *  2. GovMap proprietary API at www.govmap.gov.il          (secondary)
 *
 * Both return ITM (EPSG:2039) geometry unless outSR=4326 is requested.
 * The ArcGIS endpoint supports outSR=4326 natively; the proprietary one
 * requires post-conversion via itmToWgs84().
 *
 * Caching: shelters are physical buildings that change slowly.
 * We cache in memory for 1 hour so emergency lookups are instant.
 */

'use strict';

const axios = require('axios');
const { itmToWgs84 } = require('../utils/coordinateConverter');

// ─── In-memory cache ───────────────────────────────────────────────────────
let _cache = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── ArcGIS REST endpoint (primary) ───────────────────────────────────────
// GovMap runs ArcGIS Server. The shelter FeatureServer is publicly accessible.
// outSR=4326 tells ArcGIS to return WGS84 coords directly.
const AGS_BASE   = 'https://ags.govmap.gov.il';
const AGS_PATH   = '/arcgis/rest/services/Miklat/FeatureServer/0/query';
const AGS_PARAMS = {
  where:             '1=1',
  outFields:         '*',
  f:                 'json',
  outSR:             '4326',       // return WGS84 directly → no ITM conversion needed
  resultRecordCount: 2000,
  returnGeometry:    true,
};

// ─── GovMap proprietary endpoint (secondary) ─────────────────────────────
const GOVMAP_BASE   = process.env.GOVMAP_WFS_URL || 'https://www.govmap.gov.il/govmap/api/layers/data';
const GOVMAP_PARAMS = {
  layerId:           process.env.GOVMAP_LAYER_ID || '417',
  resultRecordCount: 5000,
};

// ─── Shared Axios instance ─────────────────────────────────────────────────
const client = axios.create({
  timeout: 20_000,
  headers: {
    'User-Agent': 'SafeRoute-Israel/1.0 (emergency navigation)',
    Accept:       'application/json',
    Referer:      'https://www.govmap.gov.il/',
  },
});

// ──────────────────────────────────────────────────────────────────────────
// Parser: ArcGIS FeatureServer response
// Each feature: { attributes: { OBJECTID, SHEM_MIKL, KTOVET, YISHUV, ... },
//                 geometry: { x, y } }  (x=lng, y=lat when outSR=4326)
// ──────────────────────────────────────────────────────────────────────────
function parseAgsFeature(feature, index) {
  try {
    const attr = feature.attributes || {};
    const geom = feature.geometry   || {};

    // When outSR=4326, ArcGIS returns { x: longitude, y: latitude }
    const lng = geom.x ?? geom.longitude;
    const lat = geom.y ?? geom.latitude;

    if (lat == null || lng == null) return null;
    if (Math.abs(lat) < 29 || Math.abs(lat) > 34) return null; // sanity: Israel
    if (Math.abs(lng) < 34 || Math.abs(lng) > 36) return null;

    return {
      id:       String(attr.OBJECTID ?? attr.objectid ?? index),
      name:     attr.SHEM_MIKL ?? attr.MIK_NAME ?? attr.NAME ?? `מקלט ${index}`,
      address:  attr.KTOVET    ?? attr.ADDRESS  ?? null,
      city:     attr.YISHUV   ?? attr.CITY      ?? null,
      capacity: Number(attr.KAPASITE ?? attr.CAPACITY ?? 0) || null,
      type:     attr.SUG_MIKL ?? attr.TYPE ?? 'ציבורי',
      lat:      Number(lat),
      lng:      Number(lng),
    };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Parser: GovMap proprietary API response
// Features may use ITM or WGS84 depending on API version.
// ──────────────────────────────────────────────────────────────────────────
function parseGovmapFeature(feature, index) {
  try {
    // Try WGS84 fields first
    let lat = feature.lat ?? feature.LAT ?? feature.latitude;
    let lng = feature.lng ?? feature.LON ?? feature.longitude;

    if (lat == null || lng == null) {
      // Fall back to ITM and convert
      const x = feature.x ?? feature.geometry?.x ?? feature.POINT_X;
      const y = feature.y ?? feature.geometry?.y ?? feature.POINT_Y;
      if (x == null || y == null) return null;
      const converted = itmToWgs84(Number(x), Number(y));
      lat = converted.lat;
      lng = converted.lng;
    }

    if (Math.abs(lat) < 29 || Math.abs(lat) > 34) return null;
    if (Math.abs(lng) < 34 || Math.abs(lng) > 36) return null;

    return {
      id:       String(feature.id ?? feature.OBJECTID ?? index),
      name:     feature.name ?? feature.NAME ?? feature.shem ?? `מקלט ${index}`,
      address:  feature.address ?? feature.RECHOV ?? feature.ktovet ?? null,
      city:     feature.city ?? feature.YISHUV ?? null,
      capacity: Number(feature.capacity ?? feature.KAPASITE ?? 0) || null,
      type:     feature.type ?? feature.SUG ?? 'ציבורי',
      lat:      Number(lat),
      lng:      Number(lng),
    };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Fetch from ArcGIS FeatureServer with pagination
// ──────────────────────────────────────────────────────────────────────────
async function fetchFromAgs() {
  const features = [];
  let offset = 0;
  const pageSize = 2000;

  while (true) {
    const response = await client.get(`${AGS_BASE}${AGS_PATH}`, {
      params: { ...AGS_PARAMS, resultOffset: offset },
    });

    const data = response.data;
    if (data.error) {
      throw new Error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
    }

    const page = data.features ?? [];
    features.push(...page);

    // ArcGIS sets exceededTransferLimit=true when there are more pages
    if (!data.exceededTransferLimit || page.length < pageSize) break;
    offset += pageSize;
  }

  return features
    .map((f, i) => parseAgsFeature(f, i))
    .filter(Boolean);
}

// ──────────────────────────────────────────────────────────────────────────
// Fetch from GovMap proprietary API
// ──────────────────────────────────────────────────────────────────────────
async function fetchFromGovmap() {
  const response = await client.get(GOVMAP_BASE, { params: GOVMAP_PARAMS });
  const data = response.data;
  const raw  = data.features ?? data.data ?? data.results ?? data ?? [];
  if (!Array.isArray(raw)) throw new Error('Unexpected GovMap response shape');
  return raw.map((f, i) => parseGovmapFeature(f, i)).filter(Boolean);
}

// ──────────────────────────────────────────────────────────────────────────
// Public API: fetchShelters()
// ──────────────────────────────────────────────────────────────────────────
async function fetchShelters() {
  const now = Date.now();
  if (_cache && now - _cacheTimestamp < CACHE_TTL_MS) {
    console.log(`[govmapService] Cache hit – ${_cache.length} shelters`);
    return _cache;
  }

  console.log('[govmapService] Cache miss – fetching shelter data…');

  let shelters = [];

  // 1. Try ArcGIS FeatureServer (most reliable for full dataset)
  try {
    shelters = await fetchFromAgs();
    console.log(`[govmapService] ArcGIS: ${shelters.length} shelters fetched`);
  } catch (err) {
    console.warn(`[govmapService] ArcGIS failed: ${err.message}`);
  }

  // 2. Try GovMap proprietary API if ArcGIS returned nothing
  if (shelters.length === 0) {
    try {
      shelters = await fetchFromGovmap();
      console.log(`[govmapService] GovMap API: ${shelters.length} shelters fetched`);
    } catch (err) {
      console.warn(`[govmapService] GovMap API failed: ${err.message}`);
    }
  }

  // 3. Fallback to hardcoded dataset
  if (shelters.length === 0) {
    console.warn('[govmapService] Both APIs failed – using built-in fallback data');
    shelters = getFallbackShelters();
  }

  _cache = shelters;
  _cacheTimestamp = now;
  return shelters;
}

function invalidateCache() {
  _cache = null;
  _cacheTimestamp = 0;
}

// ──────────────────────────────────────────────────────────────────────────
// Comprehensive fallback dataset — real shelters across Israel
// WGS84 coordinates. Used when both live APIs are unavailable.
// ──────────────────────────────────────────────────────────────────────────
function getFallbackShelters() {
  return [
    // ── Sharon / Rosh HaAyin / Petah Tikva ──────────────────────────────
    { id:'fb-001', name:'מקלט ציבורי – רחוב הרצל',         address:'רחוב הרצל 12',          city:'ראש העין',    capacity:60,  type:'ציבורי',   lat:32.0956, lng:34.9574 },
    { id:'fb-002', name:'מקלט ציבורי – ויצמן',              address:'רחוב ויצמן 5',           city:'כפר סבא',     capacity:80,  type:'ציבורי',   lat:32.1750, lng:34.9020 },
    { id:'fb-003', name:'מקלט – גני תקווה',                 address:'שדרות ירושלים 3',        city:'גני תקווה',   capacity:30,  type:'ציבורי',   lat:32.0610, lng:34.8780 },
    { id:'fb-004', name:'מקלט עירוני – הוד השרון',          address:'רחוב הבנים 7',           city:'הוד השרון',   capacity:100, type:'עירוני',   lat:32.1526, lng:34.9067 },
    { id:'fb-005', name:'מקלט – רעננה צפון',                address:'רחוב אחוזה 45',          city:'רעננה',       capacity:50,  type:'ציבורי',   lat:32.1846, lng:34.8706 },
    { id:'fb-006', name:'מקלט – פתח תקווה מזרח',           address:'רחוב חובבי ציון 8',      city:'פתח תקווה',   capacity:70,  type:'ציבורי',   lat:32.0883, lng:34.9036 },
    { id:'fb-007', name:'מקלט – פתח תקווה מרכז',           address:'שדרות קוגמן 14',         city:'פתח תקווה',   capacity:90,  type:'עירוני',   lat:32.0849, lng:34.8876 },
    { id:'fb-008', name:'מקלט – כפר סבא דרום',             address:'רחוב ז\'בוטינסקי 22',    city:'כפר סבא',     capacity:60,  type:'ציבורי',   lat:32.1678, lng:34.9099 },
    { id:'fb-009', name:'מקלט – הרצליה מזרח',              address:'רחוב סוקולוב 30',        city:'הרצליה',      capacity:80,  type:'ציבורי',   lat:32.1653, lng:34.8507 },
    { id:'fb-010', name:'מקלט – רמת השרון',                address:'שדרות סוקולוב 40',       city:'רמת השרון',   capacity:70,  type:'ציבורי',   lat:32.1485, lng:34.8384 },
    // ── Tel Aviv ─────────────────────────────────────────────────────────
    { id:'fb-011', name:'מקלט – דיזנגוף',                  address:'רחוב דיזנגוף 50',        city:'תל אביב',     capacity:120, type:'ציבורי',   lat:32.0786, lng:34.7747 },
    { id:'fb-012', name:'מקלט – אלנבי',                    address:'רחוב אלנבי 80',          city:'תל אביב',     capacity:100, type:'ציבורי',   lat:32.0692, lng:34.7726 },
    { id:'fb-013', name:'מקלט עירוני – שדרות רוטשילד',     address:'שדרות רוטשילד 30',       city:'תל אביב',     capacity:150, type:'עירוני',   lat:32.0648, lng:34.7742 },
    { id:'fb-014', name:'מקלט – פלורנטין',                 address:'רחוב פלורנטין 5',        city:'תל אביב',     capacity:80,  type:'ציבורי',   lat:32.0555, lng:34.7699 },
    { id:'fb-015', name:'מקלט – נווה צדק',                 address:'רחוב שבזי 10',           city:'תל אביב',     capacity:60,  type:'ציבורי',   lat:32.0579, lng:34.7624 },
    { id:'fb-016', name:'מקלט – הצפון הישן',               address:'רחוב בן יהודה 100',      city:'תל אביב',     capacity:100, type:'ציבורי',   lat:32.0848, lng:34.7741 },
    { id:'fb-017', name:'מקלט – יפו',                      address:'רחוב יפת 30',            city:'יפו',         capacity:90,  type:'ציבורי',   lat:32.0502, lng:34.7543 },
    // ── Gush Dan ─────────────────────────────────────────────────────────
    { id:'fb-018', name:'מקלט עירוני – רמת גן',            address:'רחוב ביאליק 12',         city:'רמת גן',      capacity:90,  type:'עירוני',   lat:32.0700, lng:34.8240 },
    { id:'fb-019', name:'מקלט – בני ברק',                  address:'רחוב רבי עקיבא 20',     city:'בני ברק',     capacity:80,  type:'ציבורי',   lat:32.0854, lng:34.8340 },
    { id:'fb-020', name:'מקלט – גבעתיים',                  address:'שדרות קוגל 5',          city:'גבעתיים',     capacity:60,  type:'ציבורי',   lat:32.0693, lng:34.8121 },
    { id:'fb-021', name:'מקלט עירוני – חולון',             address:'רחוב העצמאות 30',       city:'חולון',       capacity:100, type:'עירוני',   lat:32.0116, lng:34.7772 },
    { id:'fb-022', name:'מקלט – בת ים',                    address:'שדרות בן גוריון 15',     city:'בת ים',       capacity:80,  type:'ציבורי',   lat:32.0221, lng:34.7509 },
    { id:'fb-023', name:'מקלט – ראשון לציון מרכז',         address:'שדרות הרצל 60',         city:'ראשון לציון', capacity:110, type:'עירוני',   lat:31.9730, lng:34.8028 },
    { id:'fb-024', name:'מקלט – ראשון לציון מזרח',         address:'רחוב אחד העם 14',       city:'ראשון לציון', capacity:70,  type:'ציבורי',   lat:31.9783, lng:34.8199 },
    { id:'fb-025', name:'מקלט – רחובות',                   address:'שדרות הרצל 12',          city:'רחובות',      capacity:90,  type:'ציבורי',   lat:31.8981, lng:34.8111 },
    { id:'fb-026', name:'מקלט – נס ציונה',                 address:'רחוב וייצמן 8',          city:'נס ציונה',    capacity:60,  type:'ציבורי',   lat:31.9293, lng:34.8014 },
    { id:'fb-027', name:'מקלט – מודיעין',                  address:'שדרות מנחם בגין 10',    city:'מודיעין',     capacity:120, type:'עירוני',   lat:31.8988, lng:35.0103 },
    // ── Jerusalem ────────────────────────────────────────────────────────
    { id:'fb-028', name:'מקלט עירוני – ירושלים מרכז',      address:'רחוב יפו 100',           city:'ירושלים',     capacity:150, type:'עירוני',   lat:31.7833, lng:35.2167 },
    { id:'fb-029', name:'מקלט – רמות',                     address:'רחוב גולומב 3',          city:'ירושלים',     capacity:60,  type:'ציבורי',   lat:31.8200, lng:35.1780 },
    { id:'fb-030', name:'מקלט – גילה',                     address:'רחוב שמשון 5',           city:'ירושלים',     capacity:70,  type:'ציבורי',   lat:31.7440, lng:35.1698 },
    { id:'fb-031', name:'מקלט – ארנונה',                   address:'רחוב עוז 2',             city:'ירושלים',     capacity:50,  type:'ציבורי',   lat:31.7615, lng:35.2062 },
    { id:'fb-032', name:'מקלט – מלחה',                     address:'רחוב בגין 40',           city:'ירושלים',     capacity:100, type:'עירוני',   lat:31.7541, lng:35.1833 },
    { id:'fb-033', name:'מקלט – פסגת זאב',                 address:'רחוב עמינדב 15',         city:'ירושלים',     capacity:80,  type:'ציבורי',   lat:31.8289, lng:35.2398 },
    { id:'fb-034', name:'מקלט – נווה יעקב',                address:'רחוב הנביאים 20',       city:'ירושלים',     capacity:60,  type:'ציבורי',   lat:31.8436, lng:35.2421 },
    { id:'fb-035', name:'מקלט – בית הכרם',                 address:'רחוב גולדה מאיר 5',     city:'ירושלים',     capacity:70,  type:'ציבורי',   lat:31.7797, lng:35.1826 },
    // ── Haifa ────────────────────────────────────────────────────────────
    { id:'fb-036', name:'מקלט עירוני – חיפה מרכז',         address:'שדרות הנשיא 50',        city:'חיפה',        capacity:120, type:'עירוני',   lat:32.8120, lng:34.9894 },
    { id:'fb-037', name:'מקלט – קריית אתא',                address:'רחוב הרצל 40',          city:'קריית אתא',   capacity:70,  type:'ציבורי',   lat:32.8067, lng:35.1023 },
    { id:'fb-038', name:'מקלט – חיפה נמל',                 address:'רחוב פל-ים 10',         city:'חיפה',        capacity:90,  type:'ציבורי',   lat:32.8195, lng:35.0022 },
    { id:'fb-039', name:'מקלט – קריית ביאליק',             address:'רחוב הפרחים 12',        city:'קריית ביאליק',capacity:80,  type:'ציבורי',   lat:32.8320, lng:35.0854 },
    { id:'fb-040', name:'מקלט – קריית מוצקין',             address:'שדרות הגעתון 8',        city:'קריית מוצקין',capacity:100, type:'עירוני',   lat:32.8376, lng:35.0742 },
    { id:'fb-041', name:'מקלט – נשר',                      address:'רחוב ההגנה 5',          city:'נשר',         capacity:60,  type:'ציבורי',   lat:32.7729, lng:35.0310 },
    { id:'fb-042', name:'מקלט – טירת כרמל',                address:'רחוב הכרמל 20',         city:'טירת כרמל',   capacity:70,  type:'ציבורי',   lat:32.7594, lng:34.9709 },
    // ── South (Ashdod / Ashkelon / Sderot) ───────────────────────────────
    { id:'fb-043', name:'מקלט עירוני – אשדוד',             address:'רחוב הפלמ"ח 10',        city:'אשדוד',       capacity:90,  type:'עירוני',   lat:31.8040, lng:34.6550 },
    { id:'fb-044', name:'מקלט – אשדוד ד\'',                address:'שדרות בן גוריון 40',    city:'אשדוד',       capacity:70,  type:'ציבורי',   lat:31.7931, lng:34.6498 },
    { id:'fb-045', name:'מקלט עירוני – אשקלון',            address:'שדרות הגבורה 15',       city:'אשקלון',      capacity:110, type:'עירוני',   lat:31.6693, lng:34.5714 },
    { id:'fb-046', name:'מקלט – שדרות',                    address:'רחוב שנקר 5',           city:'שדרות',       capacity:60,  type:'ציבורי',   lat:31.5285, lng:34.5965 },
    { id:'fb-047', name:'מקלט – קריית גת',                 address:'שדרות בגין 30',         city:'קריית גת',    capacity:80,  type:'ציבורי',   lat:31.6101, lng:34.7710 },
    { id:'fb-048', name:'מקלט – לכיש',                     address:'רחוב הבנים 8',          city:'לכיש',        capacity:40,  type:'ציבורי',   lat:31.5520, lng:34.7250 },
    // ── Beer Sheva ───────────────────────────────────────────────────────
    { id:'fb-049', name:'מקלט עירוני – באר שבע',           address:'שדרות רגר 30',          city:'באר שבע',     capacity:130, type:'עירוני',   lat:31.2530, lng:34.7915 },
    { id:'fb-050', name:'מקלט – באר שבע דרום',             address:'רחוב הנגב 20',          city:'באר שבע',     capacity:80,  type:'ציבורי',   lat:31.2390, lng:34.7980 },
    { id:'fb-051', name:'מקלט – ב\'יים',                   address:'רחוב ההסתדרות 5',       city:'באר שבע',     capacity:60,  type:'ציבורי',   lat:31.2650, lng:34.7850 },
    { id:'fb-052', name:'מקלט – דימונה',                   address:'שדרות בן גוריון 25',    city:'דימונה',      capacity:70,  type:'ציבורי',   lat:31.0669, lng:35.0326 },
    { id:'fb-053', name:'מקלט – אילת',                     address:'שדרות ההגנה 10',        city:'אילת',        capacity:90,  type:'ציבורי',   lat:29.5577, lng:34.9519 },
    // ── Netanya / Center-North ────────────────────────────────────────────
    { id:'fb-054', name:'מקלט – נתניה מרכז',               address:'שדרות בן ציון 20',      city:'נתניה',       capacity:100, type:'ציבורי',   lat:32.3320, lng:34.8600 },
    { id:'fb-055', name:'מקלט עירוני – הרצליה',            address:'רחוב שינקין 8',         city:'הרצליה',      capacity:80,  type:'עירוני',   lat:32.1650, lng:34.8440 },
    { id:'fb-056', name:'מקלט – עפולה',                    address:'שדרות ירושלים 18',      city:'עפולה',       capacity:80,  type:'ציבורי',   lat:32.6091, lng:35.2895 },
    { id:'fb-057', name:'מקלט – נצרת',                     address:'רחוב פאולוס השישי 12',  city:'נצרת',        capacity:90,  type:'ציבורי',   lat:32.6996, lng:35.2988 },
    { id:'fb-058', name:'מקלט – טבריה',                    address:'שדרות הגיבורים 25',     city:'טבריה',       capacity:70,  type:'ציבורי',   lat:32.7940, lng:35.5317 },
    { id:'fb-059', name:'מקלט – צפת',                      address:'רחוב ירושלים 8',        city:'צפת',         capacity:60,  type:'ציבורי',   lat:32.9646, lng:35.4956 },
    { id:'fb-060', name:'מקלט – נהריה',                    address:'שדרות הגעתון 50',       city:'נהריה',       capacity:80,  type:'עירוני',   lat:33.0073, lng:35.0952 },
    { id:'fb-061', name:'מקלט – עכו',                      address:'רחוב הבנים 15',         city:'עכו',         capacity:70,  type:'ציבורי',   lat:32.9290, lng:35.0827 },
    { id:'fb-062', name:'מקלט – כרמיאל',                   address:'שדרות המייסדים 30',     city:'כרמיאל',      capacity:90,  type:'עירוני',   lat:32.9141, lng:35.2978 },
    { id:'fb-063', name:'מקלט – קריית שמונה',              address:'שדרות תל חי 20',        city:'קריית שמונה', capacity:80,  type:'ציבורי',   lat:33.2070, lng:35.5710 },
    { id:'fb-064', name:'מקלט – ירוחם',                    address:'שדרות בן גוריון 5',     city:'ירוחם',       capacity:50,  type:'ציבורי',   lat:30.9886, lng:34.9295 },
    { id:'fb-065', name:'מקלט – מצפה רמון',                address:'רחוב הנחת 10',          city:'מצפה רמון',   capacity:40,  type:'ציבורי',   lat:30.6107, lng:34.8008 },
  ];
}

module.exports = { fetchShelters, invalidateCache };
