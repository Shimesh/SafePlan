/**
 * mockData.ts
 *
 * Test / demo data for the "Rosh HaAyin → Sharon region" scenario.
 *
 * Scenario timeline:
 *  T+0s   App starts, user completes checklist
 *  T+30s  Navigation starts, route + shelters render on map
 *  T+60s  Mock emergency alert fires ("Threat from Iran", 90s to impact)
 *  T+61s  App auto-reroutes to nearest shelter (מקלט הוד השרון)
 *  T+90s  Impact countdown reaches zero (user should be in shelter)
 *
 * All coordinates are real WGS84 positions verified on Google Maps.
 */

import type { Shelter, Alert } from '../types';

// ─── Route waypoints (Rosh HaAyin → Kfar Saba via Route 5 / Route 4) ────────
export const MOCK_ROUTE_WAYPOINTS = [
  { lat: 32.0956, lng: 34.9574 }, // Rosh HaAyin (start)
  { lat: 32.1043, lng: 34.9490 }, // Junction Rosh HaAyin North
  { lat: 32.1234, lng: 34.9312 }, // Approaching Hod HaSharon
  { lat: 32.1526, lng: 34.9067 }, // Hod HaSharon
  { lat: 32.1650, lng: 34.9042 }, // North of Hod HaSharon
  { lat: 32.1784, lng: 34.9038 }, // Kfar Saba (destination)
];

// ─── Mock shelter database (matches backend fallback data) ───────────────────
export const MOCK_SHELTERS: Shelter[] = [
  {
    id: 'mock-s1',
    name: 'מקלט ציבורי – ראש העין',
    address: 'רחוב הרצל 12, ראש העין',
    capacity: 60,
    type: 'public',
    lat: 32.0965,
    lng: 34.9521,
  },
  {
    id: 'mock-s2',
    name: 'מקלט עירוני – הוד השרון',
    address: 'רחוב הבנים 7, הוד השרון',
    capacity: 100,
    type: 'municipal',
    lat: 32.1526,
    lng: 34.9067,
  },
  {
    id: 'mock-s3',
    name: 'מקלט ציבורי – כפר סבא מרכז',
    address: 'רחוב ויצמן 5, כפר סבא',
    capacity: 80,
    type: 'public',
    lat: 32.1750,
    lng: 34.9020,
  },
  {
    id: 'mock-s4',
    name: 'מקלט – גני תקווה',
    address: 'שדרות ירושלים 3, גני תקווה',
    capacity: 30,
    type: 'public',
    lat: 32.0610,
    lng: 34.8780,
  },
  {
    id: 'mock-s5',
    name: 'מקלט – רעננה צפון',
    address: 'רחוב אחוזה 45, רעננה',
    capacity: 50,
    type: 'public',
    lat: 32.1846,
    lng: 34.8706,
  },
  {
    id: 'mock-s6',
    name: 'מקלט – פתח תקווה מזרח',
    address: 'רחוב חובבי ציון 8, פתח תקווה',
    capacity: 70,
    type: 'public',
    lat: 32.0883,
    lng: 34.9036,
  },
];

// ─── Mock alert (Iranian ballistic missile, 90s to impact) ──────────────────
export const MOCK_ALERT: Alert = {
  id: `mock-alert-${Date.now()}`,
  title: 'ירי רקטות ופגזים',
  threatOrigin: 'Iran',
  regions: ['שרון', 'גוש דן'],
  timeToImpact: 90, // seconds
  category: 4,       // Pikud HaOref category for Iran
  timestamp: new Date().toISOString(),
};

// ─── Scenario runner ─────────────────────────────────────────────────────────
/**
 * Simulates the Rosh HaAyin → Sharon emergency scenario.
 *
 * Call this in MapScreen when EXPO_PUBLIC_MOCK_MODE=true.
 * The callback fires after 60 seconds, mimicking an alert mid-drive.
 *
 * @param onAlert  Called with the mock alert when the scenario triggers
 * @returns        Cleanup function that cancels the timer (call on unmount)
 *
 * @example
 * useEffect(() => {
 *   if (process.env.EXPO_PUBLIC_MOCK_MODE === 'true') {
 *     return runMockScenario(handleAlert);
 *   }
 * }, []);
 */
export function runMockScenario(onAlert: (alert: Alert) => void): () => void {
  console.log('[mockData] 🎬 Mock scenario started. Alert fires in 60 seconds.');

  const timer = setTimeout(() => {
    console.log('[mockData] 🚨 Mock alert firing!');
    onAlert({ ...MOCK_ALERT, timestamp: new Date().toISOString() });
  }, 60_000);

  return () => {
    clearTimeout(timer);
    console.log('[mockData] Mock scenario cancelled.');
  };
}

// ─── Simulated GPS positions (for UI testing without a real device) ──────────
/**
 * Returns a simulated GPS position along the Rosh HaAyin → Kfar Saba route.
 * `progress` should be a value between 0 (start) and 1 (destination).
 */
export function getSimulatedPosition(progress: number): { lat: number; lng: number } {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const index = clampedProgress * (MOCK_ROUTE_WAYPOINTS.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  const from = MOCK_ROUTE_WAYPOINTS[lower];
  const to   = MOCK_ROUTE_WAYPOINTS[upper];

  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lng: from.lng + (to.lng - from.lng) * fraction,
  };
}
