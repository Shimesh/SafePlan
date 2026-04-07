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

/** A single turn-by-turn navigation step from Google Directions. */
export interface NavigationStep {
  /** Human-readable instruction (HTML-stripped). In the language of the request. */
  instruction: string;
  distanceMeters: number;
  /** Formatted distance string, e.g. "350 מ'" or "1.2 ק"מ". */
  distanceText: string;
  /** The GPS coordinate where this step ends / next step begins. */
  endLocation: LatLng;
  /** Google maneuver key: 'turn-left' | 'turn-right' | 'straight' | 'roundabout-right' | … */
  maneuver: string;
}

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

/**
 * An active Pikud HaOref alert.
 *
 * alertType values:
 *  'preliminary' = התרעה מקדימה — early warning, ballistic threat detected at launch.
 *                  User has more time; navigate to shelter without panic.
 *  'active'      = אזעקה פעילה   — rocket/missile already in flight, siren sounds now.
 *                  Enter shelter IMMEDIATELY.
 */
export interface Alert {
  id: string;
  title: string;
  threatOrigin: string;    // 'Iran' | 'Gaza' | 'Lebanon' | 'Yemen' | Hebrew title | …
  regions: string[];       // Hebrew region names from oref API
  /** Seconds from siren until impact (= how long you have once the siren fires). */
  timeToImpact: number;
  /**
   * Seconds of preliminary warning BEFORE the siren fires.
   * 0 for rockets (siren immediately); 60-180 for ballistic missiles (Iran/Yemen).
   */
  warningTimeSeconds: number;
  category: number;        // oref `cat` field
  timestamp: string;       // ISO-8601
  alertType: 'preliminary' | 'active';
}
