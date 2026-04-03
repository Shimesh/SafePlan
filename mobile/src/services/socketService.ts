/**
 * socketService.ts
 *
 * Manages the Socket.io connection to the SafeRoute Israel backend.
 * Exposes a singleton socket instance so every screen uses the same
 * connection (avoids duplicate alert emissions).
 *
 * Usage in MapScreen:
 *   import socketService from '../services/socketService';
 *   const socket = socketService.connect();
 *   socket.on('alert', handleAlert);
 *   // on unmount:
 *   socketService.disconnect();
 */

import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';

const BASE_URL =
  (Constants.expoConfig?.extra as Record<string, string>)?.backendUrl ??
  process.env.EXPO_PUBLIC_BACKEND_URL ??
  'http://localhost:3001';

// Socket event type definitions for type-safe usage
export interface ServerToClientEvents {
  alert: (payload: {
    id: string;
    title: string;
    threatOrigin: string;
    regions: string[];
    timeToImpact: number;
    category: number;
    timestamp: string;
  }) => void;
}

export interface ClientToServerEvents {
  requestCurrentAlert: () => void;
}

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ─── Singleton instance ───────────────────────────────────────────────────
let _socket: AppSocket | null = null;

const socketService = {
  /**
   * Create (or return existing) Socket.io connection.
   * Safe to call multiple times – returns the same socket.
   */
  connect(): AppSocket {
    if (_socket?.connected) return _socket;

    _socket = io(BASE_URL, {
      transports: ['websocket'],       // prefer WebSocket over polling for speed
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,         // start with 2 s, backs off automatically
      timeout: 10_000,
    }) as AppSocket;

    _socket.on('connect', () => {
      console.log('[socket] Connected to backend:', _socket?.id);
      // Ask backend for the current alert state immediately on (re)connect
      _socket?.emit('requestCurrentAlert');
    });

    _socket.on('connect_error', (err) => {
      console.warn('[socket] Connection error:', err.message);
    });

    _socket.on('disconnect', (reason) => {
      console.log('[socket] Disconnected:', reason);
    });

    return _socket;
  },

  /**
   * Cleanly disconnect and destroy the socket instance.
   * Call this on app background / unmount to save battery.
   */
  disconnect(): void {
    if (_socket) {
      _socket.disconnect();
      _socket = null;
      console.log('[socket] Socket destroyed.');
    }
  },

  /** True when a socket exists and is currently connected. */
  get isConnected(): boolean {
    return _socket?.connected ?? false;
  },
};

export default socketService;
