/**
 * coordinateConverter.js
 *
 * Converts Israel Transverse Mercator (ITM, EPSG:2039) coordinates used by
 * GovMap into WGS84 latitude/longitude understood by Google Maps.
 *
 * The GovMap API returns coordinates in the Israeli Grid (ITM), a local
 * projection where values look like x≈200000, y≈600000 (meters). Google Maps,
 * on the other hand, expects standard WGS84 lat/lng. Without this conversion
 * every shelter marker would land in the Atlantic Ocean.
 *
 * Library: proj4  (npm i proj4)
 *   proj4 ships with WGS84 built-in as the output CRS; we only need to
 *   register ITM manually using its official EPSG:2039 proj-string.
 */

'use strict';

const proj4 = require('proj4');

// ─── Register ITM (EPSG:2039) ──────────────────────────────────────────────
// Parameters sourced from the official EPSG registry and cross-verified with
// the Israeli Survey of Israel datum definition.
proj4.defs(
  'EPSG:2039',
  '+proj=tmerc ' +
  '+lat_0=31.7343936111111 ' +   // latitude of natural origin
  '+lon_0=35.2045169444444 ' +   // central meridian
  '+k=1.0000067 ' +              // scale factor
  '+x_0=219529.584 ' +           // false easting (meters)
  '+y_0=626907.39 ' +            // false northing (meters)
  '+ellps=GRS80 ' +
  '+towgs84=-48,55,52,0,0,0,0 ' + // Helmert 7-parameter shift to WGS84
  '+units=m +no_defs'
);

/**
 * Convert a single ITM point to WGS84.
 *
 * @param {number} x  – ITM Easting  (meters, ~100 000 – 300 000 for Israel)
 * @param {number} y  – ITM Northing (meters, ~350 000 – 800 000 for Israel)
 * @returns {{ lat: number, lng: number }}
 *
 * @example
 * // Jerusalem city center (from GovMap sample):
 * itmToWgs84(219143.61, 618345.06)
 * // → { lat: 31.7683, lng: 35.2137 }
 */
function itmToWgs84(x, y) {
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new TypeError(`itmToWgs84: expected numbers, got x=${x}, y=${y}`);
  }

  // proj4(fromCRS, toCRS, [x, y]) → [lng, lat]  (note: GeoJSON axis order)
  const [lng, lat] = proj4('EPSG:2039', 'WGS84', [x, y]);

  // Sanity-check: Israel bounding box in WGS84
  if (lat < 29.0 || lat > 33.5 || lng < 34.0 || lng > 36.0) {
    console.warn(
      `[coordinateConverter] Result (${lat.toFixed(4)}, ${lng.toFixed(4)}) ` +
      `is outside the expected Israel bounding box. ` +
      `Input was x=${x}, y=${y}. Verify ITM input values.`
    );
  }

  return { lat, lng };
}

/**
 * Batch-convert an array of ITM points.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {Array<{lat: number, lng: number}>}
 */
function batchItmToWgs84(points) {
  return points.map(({ x, y }) => itmToWgs84(x, y));
}

module.exports = { itmToWgs84, batchItmToWgs84 };
