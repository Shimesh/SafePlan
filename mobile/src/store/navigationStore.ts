/**
 * navigationStore.ts
 *
 * Manages the user's navigation session: destination, decoded route polyline,
 * live GPS position, and whether navigation is currently active.
 *
 * Pattern: Zustand slice with actions co-located in the store definition.
 */

import { create } from 'zustand';
import type { LatLng, Polyline } from '../types';

interface Destination {
  lat: number;
  lng: number;
  name: string;
}

interface NavigationState {
  // ── State ──────────────────────────────────────────────────────────────
  destination: Destination | null;
  /** Decoded Google Directions polyline for the primary route. */
  route: Polyline | null;
  /** User's live GPS position from expo-location. */
  currentLocation: LatLng | null;
  isNavigating: boolean;

  // ── Actions ────────────────────────────────────────────────────────────
  setDestination: (destination: Destination | null) => void;
  setRoute: (route: Polyline | null) => void;
  setCurrentLocation: (location: LatLng) => void;
  startNavigation: () => void;
  stopNavigation: () => void;
  reset: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  // ── Initial state ──────────────────────────────────────────────────────
  destination: null,
  route: null,
  currentLocation: null,
  isNavigating: false,

  // ── Action implementations ─────────────────────────────────────────────
  setDestination: (destination) => set({ destination }),

  setRoute: (route) => set({ route }),

  setCurrentLocation: (currentLocation) => set({ currentLocation }),

  startNavigation: () => set({ isNavigating: true }),

  stopNavigation: () => set({ isNavigating: false }),

  reset: () =>
    set({
      destination: null,
      route: null,
      currentLocation: null,
      isNavigating: false,
    }),
}));
