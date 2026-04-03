/**
 * api.ts
 *
 * Axios HTTP client pre-configured to talk to the SafeRoute Israel backend.
 * All REST calls go through this module so the base URL is defined once and
 * error handling is centralised.
 */

import axios from 'axios';
import Constants from 'expo-constants';
import type { Shelter, Alert } from '../types';

// ─── Base URL ──────────────────────────────────────────────────────────────
// Priority: app.json extras → EXPO_PUBLIC_BACKEND_URL env var → localhost fallback
// In production EXPO_PUBLIC_BACKEND_URL must be set; the localhost fallback
// will only work when the backend runs on the same machine as the dev client.
const CONFIGURED_URL =
  (Constants.expoConfig?.extra as Record<string, string>)?.backendUrl ??
  process.env.EXPO_PUBLIC_BACKEND_URL;

if (!CONFIGURED_URL) {
  console.warn(
    '[api] EXPO_PUBLIC_BACKEND_URL is not set. ' +
    'Falling back to http://localhost:3001 — this will NOT work on a physical device. ' +
    'Set EXPO_PUBLIC_BACKEND_URL=http://<your-lan-ip>:3001 in mobile/.env'
  );
}

const BASE_URL = CONFIGURED_URL ?? 'http://localhost:3001';

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Response interceptor – unified error logging ─────────────────────────
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.error ?? err.message ?? 'Network error';
    console.error(`[api] ${err.config?.method?.toUpperCase()} ${err.config?.url} → ${msg}`);
    return Promise.reject(new Error(msg));
  }
);

// ─── Shelter endpoints ─────────────────────────────────────────────────────

/** Fetch all shelters (WGS84 lat/lng, pre-converted by backend). */
export async function getShelters(): Promise<Shelter[]> {
  const res = await apiClient.get<{ shelters: Shelter[] }>('/api/shelters');
  return res.data.shelters;
}

/**
 * Fetch the N nearest shelters to a given location.
 * Useful as a quick fallback if the local haversine sort is too slow.
 */
export async function getNearestShelters(
  lat: number,
  lng: number,
  limit = 5
): Promise<Shelter[]> {
  const res = await apiClient.get<{ shelters: Shelter[] }>('/api/shelters/nearest', {
    params: { lat, lng, limit },
  });
  return res.data.shelters;
}

// ─── Alert endpoints ───────────────────────────────────────────────────────

/** Poll current alert (HTTP fallback when WebSocket is unavailable). */
export async function getCurrentAlert(): Promise<Alert | null> {
  const res = await apiClient.get<{ alert: Alert | null }>('/api/alerts/current');
  return res.data.alert;
}

/**
 * Inject a mock alert via the backend (dev only).
 * Triggers a Socket.io broadcast to all clients, including this device.
 */
export async function injectMockAlert(
  threatOrigin = 'Iran',
  timeToImpact = 90
): Promise<void> {
  await apiClient.post('/api/alerts/mock', { threatOrigin, timeToImpact });
}
