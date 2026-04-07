/**
 * navigationStore.ts
 *
 * Manages the user's navigation session: destination, decoded route polyline,
 * live GPS position, turn-by-turn steps, and whether navigation is currently active.
 *
 * Pattern: Zustand slice with actions co-located in the store definition.
 */

import { create } from 'zustand';
import type { LatLng, Polyline, NavigationStep } from '../types';

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
  /**
   * Per-step turn-by-turn instructions for the active route.
   * Empty when not navigating or route hasn't been loaded yet.
   */
  steps: NavigationStep[];
  /**
   * Index into `steps` for the current navigation step.
   * Advances automatically in NavigationBar when user reaches step's endLocation.
   */
  currentStepIndex: number;

  // ── Actions ────────────────────────────────────────────────────────────
  setDestination: (destination: Destination | null) => void;
  setRoute: (route: Polyline | null) => void;
  setCurrentLocation: (location: LatLng) => void;
  startNavigation: () => void;
  stopNavigation: () => void;
  /** Replace the current step list and reset the step index to 0. */
  setSteps: (steps: NavigationStep[]) => void;
  /** Advance (or jump) to a specific step index. */
  setCurrentStepIndex: (idx: number) => void;
  reset: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  // ── Initial state ──────────────────────────────────────────────────────
  destination: null,
  route: null,
  currentLocation: null,
  isNavigating: false,
  steps: [],
  currentStepIndex: 0,

  // ── Action implementations ─────────────────────────────────────────────
  setDestination: (destination) => set({ destination }),

  setRoute: (route) => set({ route }),

  setCurrentLocation: (currentLocation) => set({ currentLocation }),

  startNavigation: () => set({ isNavigating: true }),

  stopNavigation: () => set({ isNavigating: false }),

  setSteps: (steps) => set({ steps, currentStepIndex: 0 }),

  setCurrentStepIndex: (currentStepIndex) => set({ currentStepIndex }),

  reset: () =>
    set({
      destination: null,
      route: null,
      currentLocation: null,
      isNavigating: false,
      steps: [],
      currentStepIndex: 0,
    }),
}));
