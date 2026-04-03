/**
 * types.ts – Shared TypeScript interfaces used across the mobile app.
 */

/** WGS84 coordinate pair (used by Google Maps, Expo Location, etc.) */
export interface LatLng {
  lat: number;
  lng: number;
}

/** A decoded Google Maps polyline segment (array of lat/lng points). */
export type Polyline = LatLng[];

/** A public bomb shelter / safe-room record from the backend. */
export interface Shelter {
  id: string;
  name: string;
  address: string | null;
  capacity: number | null;
  type: 'public' | 'private' | 'municipal';
  lat: number;
  lng: number;
  /** Straight-line distance from user in meters (populated client-side). */
  distanceMeters?: number;
  /** Driving ETA in minutes (populated after Directions API call). */
  etaMinutes?: number;
}

/** An active Pikud HaOref missile alert. */
export interface Alert {
  id: string;
  title: string;
  threatOrigin: string; // 'Iran' | 'Gaza' | 'Lebanon' | 'Yemen' | ...
  regions: string[];    // Hebrew region names from oref API
  timeToImpact: number; // seconds
  category: number;     // oref `cat` field
  timestamp: string;    // ISO-8601
}
