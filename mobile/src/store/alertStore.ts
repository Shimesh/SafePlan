/**
 * alertStore.ts
 *
 * Manages the emergency alert state: the active Pikud HaOref alert, the
 * nearest shelter to shelter to navigate to, and the calculated shelter route.
 *
 * When `isEmergencyMode` is true, the MapScreen renders the EmergencyBanner
 * overlay and switches the displayed route to `shelterRoute`.
 */

import { create } from 'zustand';
import type { Alert, Shelter, Polyline } from '../types';

interface AlertState {
  // ── State ──────────────────────────────────────────────────────────────
  activeAlert: Alert | null;
  nearestShelter: Shelter | null;
  /** Decoded Google Directions polyline from current location → shelter. */
  shelterRoute: Polyline | null;
  isEmergencyMode: boolean;

  // ── Actions ────────────────────────────────────────────────────────────
  /**
   * Activates emergency mode.
   * Called by MapScreen when a Socket.io 'alert' event arrives.
   */
  activateEmergency: (
    alert: Alert,
    nearestShelter: Shelter,
    shelterRoute: Polyline
  ) => void;

  /**
   * Clears the emergency state.
   * Only dismiss if the user explicitly confirms – this is a life-safety app.
   */
  clearEmergency: () => void;
}

export const useAlertStore = create<AlertState>((set) => ({
  // ── Initial state ──────────────────────────────────────────────────────
  activeAlert: null,
  nearestShelter: null,
  shelterRoute: null,
  isEmergencyMode: false,

  // ── Action implementations ─────────────────────────────────────────────
  activateEmergency: (alert, nearestShelter, shelterRoute) =>
    set({
      activeAlert: alert,
      nearestShelter,
      shelterRoute,
      isEmergencyMode: true,
    }),

  clearEmergency: () =>
    set({
      activeAlert: null,
      nearestShelter: null,
      shelterRoute: null,
      isEmergencyMode: false,
    }),
}));
