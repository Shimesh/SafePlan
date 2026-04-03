/**
 * shelterStore.ts
 *
 * Manages the list of nearby bomb shelters fetched from the backend.
 * The store is populated once on MapScreen mount and then served from memory
 * (shelters don't change during a drive session).
 *
 * In emergency mode, the MapScreen reads this list and calls
 * findNearestShelter() to determine where to auto-reroute.
 */

import { create } from 'zustand';
import type { Shelter } from '../types';
import { getShelters } from '../services/api';

interface ShelterState {
  // ── State ──────────────────────────────────────────────────────────────
  shelters: Shelter[];
  loading: boolean;
  error: string | null;

  // ── Actions ────────────────────────────────────────────────────────────
  fetchShelters: () => Promise<void>;
  setShelters: (shelters: Shelter[]) => void;
}

export const useShelterStore = create<ShelterState>((set, get) => ({
  // ── Initial state ──────────────────────────────────────────────────────
  shelters: [],
  loading: false,
  error: null,

  // ── Action implementations ─────────────────────────────────────────────
  fetchShelters: async () => {
    // Don't re-fetch if we already have data (session-scoped cache)
    if (get().shelters.length > 0) return;

    set({ loading: true, error: null });
    try {
      const shelters = await getShelters();
      set({ shelters, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load shelters';
      console.error('[shelterStore] fetchShelters error:', message);
      set({ loading: false, error: message });
    }
  },

  setShelters: (shelters) => set({ shelters }),
}));
