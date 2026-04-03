/**
 * routes/shelters.js
 *
 * GET /api/shelters
 *   Returns all public bomb shelters with WGS84 lat/lng coordinates.
 *   Coordinates are pre-converted from GovMap's ITM (EPSG:2039) system.
 *
 * GET /api/shelters/nearest?lat=&lng=&limit=5
 *   Returns the N shelters nearest to the given WGS84 coordinate, sorted by
 *   straight-line (Haversine) distance. Useful for quick emergency lookup.
 *
 * POST /api/shelters/refresh  (dev/admin only)
 *   Clears the in-memory cache and re-fetches from GovMap.
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const { fetchShelters, invalidateCache } = require('../services/govmapService');

// ─── Haversine distance (meters) ─────────────────────────────────────────
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R    = 6_371_000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const toRad = (deg) => (deg * Math.PI) / 180;

// ─── GET /api/shelters ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const shelters = await fetchShelters();
    res.json({ success: true, count: shelters.length, shelters });
  } catch (err) {
    console.error('[/api/shelters] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch shelter data.' });
  }
});

// ─── GET /api/shelters/nearest?lat=32.09&lng=34.95&limit=5 ──────────────
router.get('/nearest', async (req, res) => {
  const { lat, lng, limit = '5' } = req.query;

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const maxResults = Math.min(parseInt(limit, 10) || 5, 20);

  if (Number.isNaN(userLat) || Number.isNaN(userLng)) {
    return res.status(400).json({
      success: false,
      error: 'Query params `lat` and `lng` are required and must be valid numbers.',
    });
  }

  try {
    const shelters = await fetchShelters();

    // Sort by Haversine distance and take the top N
    const sorted = shelters
      .map((s) => ({
        ...s,
        distanceMeters: haversineMeters(userLat, userLng, s.lat, s.lng),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, maxResults);

    res.json({ success: true, count: sorted.length, shelters: sorted });
  } catch (err) {
    console.error('[/api/shelters/nearest] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to compute nearest shelters.' });
  }
});

// ─── POST /api/shelters/refresh  (dev / admin) ──────────────────────────
router.post('/refresh', async (req, res) => {
  // Simple secret check to prevent abuse in production
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET && process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, error: 'Forbidden.' });
  }

  try {
    invalidateCache();
    const shelters = await fetchShelters();
    res.json({ success: true, message: 'Cache refreshed.', count: shelters.length });
  } catch (err) {
    console.error('[/api/shelters/refresh] Error:', err.message);
    res.status(500).json({ success: false, error: 'Refresh failed.' });
  }
});

module.exports = router;
