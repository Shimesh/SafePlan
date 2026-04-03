/**
 * haversine.ts
 *
 * Fast Haversine distance calculation for finding the nearest bomb shelter
 * to the user's current GPS location.
 *
 * The Haversine formula computes the great-circle (straight-line) distance
 * between two WGS84 coordinates. It is accurate to within ~0.5% for the
 * distances involved in Israel (~0–50 km), which is more than sufficient for
 * quickly ranking shelters before fetching a real driving route.
 *
 * No external dependencies – runs synchronously on the JS thread for speed.
 */

import type { LatLng, Shelter } from '../types';

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Compute the Haversine distance between two WGS84 points.
 *
 * @returns Distance in meters
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinDLng * sinDLng;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/**
 * Find the single nearest shelter to `position` from `shelters`.
 * Returns the shelter with the minimum straight-line distance.
 *
 * Also attaches a `distanceMeters` field to the returned object for display.
 *
 * @throws Error if `shelters` is empty
 */
export function findNearestShelter(position: LatLng, shelters: Shelter[]): Shelter {
  if (shelters.length === 0) {
    throw new Error('findNearestShelter: shelter list is empty');
  }

  let nearest = shelters[0];
  let nearestDist = haversineMeters(position, shelters[0]);

  for (let i = 1; i < shelters.length; i++) {
    const dist = haversineMeters(position, shelters[i]);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = shelters[i];
    }
  }

  // Attach the computed distance so callers can display it without recomputing
  return { ...nearest, distanceMeters: nearestDist };
}

/**
 * Sort `shelters` by distance from `position` (ascending) and return all of them.
 * Useful for building the ShelterList ranked by proximity.
 */
export function sortSheltersByDistance(position: LatLng, shelters: Shelter[]): Shelter[] {
  return [...shelters]
    .map((s) => ({ ...s, distanceMeters: haversineMeters(position, s) }))
    .sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
}
