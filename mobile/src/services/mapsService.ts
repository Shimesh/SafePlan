/**
 * mapsService.ts
 *
 * Thin wrapper around the Google Directions API.
 * Fetches a driving route between two WGS84 coordinates and decodes the
 * overview polyline into an array of { lat, lng } points that react-native-maps
 * can render as a <Polyline> component.
 *
 * Now also returns per-step turn-by-turn instructions in the app's current
 * language (Hebrew, English, Russian, or Arabic), driven by i18next state.
 *
 * API reference:
 *   https://developers.google.com/maps/documentation/directions/get-directions
 */

import axios from 'axios';
import type { LatLng, Polyline, NavigationStep } from '../types';
import i18n from '../i18n';

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

if (!API_KEY) {
  console.warn('[mapsService] EXPO_PUBLIC_GOOGLE_MAPS_KEY is not set. Route fetching will fail.');
}

// ─── Polyline decoder (Google's encoded polyline algorithm) ────────────────
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

// ─── Strip HTML tags from Google's html_instructions ──────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Map i18next language code → Google Directions language parameter ──────
// Google uses 'iw' for Hebrew (old ISO 639-1 code), not 'he'.
function getGoogleLangCode(): string {
  const lang = i18n.language;
  if (lang === 'he') return 'iw';
  if (lang === 'ar') return 'ar';
  if (lang === 'ru') return 'ru';
  return 'en';
}

// ─── Route fetching ────────────────────────────────────────────────────────

export interface RouteResult {
  /** Decoded polyline for map rendering. */
  polyline: Polyline;
  /** Total distance in meters. */
  distanceMeters: number;
  /** Total duration in seconds under current traffic conditions. */
  durationSeconds: number;
  /** Human-readable duration string (e.g. "12 mins" or "12 דקות"). */
  durationText: string;
  /**
   * Per-step turn-by-turn instructions from the Directions API.
   * Language matches the current i18n language of the app.
   */
  steps: NavigationStep[];
}

/**
 * Fetch a driving route from `origin` to `destination` using Google Directions.
 *
 * @param origin      - Start coordinate (WGS84)
 * @param destination - End coordinate (WGS84)
 * @returns RouteResult with decoded polyline, metadata, and per-step instructions
 * @throws Error if the API call fails or returns no routes
 */
export async function getRoute(
  origin: LatLng,
  destination: LatLng
): Promise<RouteResult> {
  const response = await axios.get(DIRECTIONS_URL, {
    params: {
      origin:         `${origin.lat},${origin.lng}`,
      destination:    `${destination.lat},${destination.lng}`,
      mode:           'driving',
      departure_time: 'now',         // enables traffic-aware duration
      language:       getGoogleLangCode(),
      key:            API_KEY,
    },
    timeout: 8000,
  });

  const data = response.data;

  if (data.status !== 'OK' || !data.routes?.length) {
    throw new Error(
      `Google Directions API error: ${data.status} – ${data.error_message ?? 'No routes found'}`
    );
  }

  const route = data.routes[0];
  const leg   = route.legs[0];

  const polyline = decodePolyline(route.overview_polyline.points);

  // ── Extract per-step instructions ─────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const steps: NavigationStep[] = (leg.steps ?? []).map((step: any) => ({
    instruction:    stripHtml(step.html_instructions ?? ''),
    distanceMeters: step.distance?.value ?? 0,
    distanceText:   step.distance?.text ?? '',
    endLocation:    {
      lat: step.end_location?.lat ?? destination.lat,
      lng: step.end_location?.lng ?? destination.lng,
    },
    maneuver: step.maneuver ?? 'straight',
  }));

  return {
    polyline,
    distanceMeters:  leg.distance.value,
    durationSeconds: (leg.duration_in_traffic ?? leg.duration).value,
    durationText:    (leg.duration_in_traffic ?? leg.duration).text,
    steps,
  };
}

/**
 * Compute driving ETA in minutes (rounded up) from `origin` to `destination`.
 * Convenience wrapper around `getRoute`.
 */
export async function getEtaMinutes(
  origin: LatLng,
  destination: LatLng
): Promise<number> {
  const result = await getRoute(origin, destination);
  return Math.ceil(result.durationSeconds / 60);
}
