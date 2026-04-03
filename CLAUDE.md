# CLAUDE.md — SafeRoute Israel

This file gives Claude Code the context it needs to work effectively on this
repository. Read it before making any changes.

---

## Project Overview

**SafeRoute Israel** is a life-safety GPS navigation app. During a Pikud HaOref
(Home Front Command) missile alert, it auto-reroutes the driver to the nearest
bomb shelter with a live countdown and ETA.

**This is a life-safety application. Code changes can affect people's safety.**
Test every change carefully. Never break the emergency alert flow.

---

## Repository Layout

```
SafePlan/
├── CLAUDE.md          ← you are here
├── README.md          ← high-level docs / quick-start
├── backend/           ← Node.js + Express server
└── mobile/            ← Expo React Native (TypeScript) app
```

---

## Running the Project

### Backend
```bash
cd backend
cp .env.example .env       # fill in env vars (see below)
npm install
npm run dev                # nodemon on port 3001
```

### Mobile
```bash
cd mobile
cp .env.example .env       # fill in EXPO_PUBLIC_GOOGLE_MAPS_KEY
npm install
npx expo start
```

### Trigger a mock emergency (no real alert needed)
```bash
curl -X POST http://localhost:3001/api/alerts/mock \
  -H "Content-Type: application/json" \
  -d '{"threatOrigin":"Iran","timeToImpact":90}'
```

Or set `EXPO_PUBLIC_MOCK_MODE=true` in `mobile/.env` — alert fires 60s after
navigation starts, simulating the Rosh HaAyin → Sharon test scenario.

---

## Key Environment Variables

### `backend/.env`
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `PIKUD_HAOREF_URL` | oref.org.il/… | Pikud HaOref alert feed |
| `GOVMAP_WFS_URL` | govmap.gov.il/… | Shelter data endpoint |
| `GOVMAP_LAYER_ID` | `417` | GovMap public shelters layer |
| `POLL_INTERVAL_MS` | `2000` | Alert polling frequency (ms) |

### `mobile/.env`
| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_GOOGLE_MAPS_KEY` | YES | Google Maps + Directions API key |
| `EXPO_PUBLIC_BACKEND_URL` | YES (on device) | Backend base URL |
| `EXPO_PUBLIC_MOCK_MODE` | No | `true` = auto-trigger emergency after 60s |

---

## Architecture at a Glance

```
Mobile App (Expo RN)
  ├── ChecklistScreen  →  calming pre-departure UI
  ├── MapScreen        →  map, route, shelter overlay, emergency mode
  ├── EmergencyBanner  →  slide-in red overlay with live countdown
  ├── Zustand stores   →  navigationStore | alertStore | shelterStore
  ├── Socket.io-client →  receives 'alert' events from backend
  └── i18n (he/en/ru/ar, RTL/LTR via I18nManager)

Backend (Express + Socket.io)
  ├── /api/shelters     →  GovMap Layer 417, ITM→WGS84 converted
  ├── /api/alerts       →  current alert + mock injection (dev)
  ├── /health           →  uptime + connected client count
  ├── pikudHaorefService →  polls oref.org.il every 2s, emits 'alert'
  └── govmapService     →  fetches shelters, 1-hour memory cache
```

---

## Critical Implementation Details

### ITM → WGS84 Coordinate Conversion
GovMap returns Israeli Grid (ITM, EPSG:2039) coordinates. Google Maps needs
WGS84. Conversion is in `backend/src/utils/coordinateConverter.js` using
`proj4`. **Never remove or bypass this conversion** — without it every shelter
marker lands in the Atlantic Ocean.

```js
itmToWgs84(219143.61, 618345.06)  // → { lat: 31.657, lng: 35.201 }
```

### Emergency Auto-Reroute Flow
```
Socket.io 'alert' event received by MapScreen
  → handleAlert() (retries up to 3× if GPS not ready yet)
  → findNearestShelter() — O(n) Haversine scan
  → getRoute() — Google Directions API call
  → alertStore.activateEmergency() — Zustand state update
  → EmergencyBanner renders, map reroutes
```

### Socket.io Listener Cleanup
`MapScreen` registers `socket.on('alert', handleAlert)` on mount and
**must** call `socket.off('alert', handleAlert)` on unmount to prevent
duplicate handlers on re-entry. This is already implemented — do not remove it.

### i18n / RTL
- Default language: Hebrew (`he`) — RTL
- Also: English (`en`), Russian (`ru`), Arabic (`ar`)
- `I18nManager.forceRTL()` requires an **app restart** to reflow layout
- All four locale files live in `mobile/src/i18n/locales/`
- **Always add new translation keys to all four locale files** when adding UI text

### Zustand Store Access in Event Handlers
Use `useXxxStore.getState()` (not the hook return value) inside async callbacks
and Socket.io event handlers to avoid stale closures:
```ts
// CORRECT — always reads the latest value
const pos = useNavigationStore.getState().currentLocation;

// WRONG — stale closure inside socket.on callback
const { currentLocation } = useNavigationStore();  // ← don't do this
```

---

## Testing

### Backend sanity checks (no Google Maps key needed)
```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/shelters
curl "http://localhost:3001/api/shelters/nearest?lat=32.09&lng=34.95&limit=3"
curl http://localhost:3001/api/alerts/current
```

### ITM conversion unit test
```bash
node -e "
  const { itmToWgs84 } = require('./backend/src/utils/coordinateConverter');
  const r = itmToWgs84(219143.61, 618345.06);
  console.assert(r.lat > 31 && r.lat < 32, 'lat out of range');
  console.assert(r.lng > 35 && r.lng < 36, 'lng out of range');
  console.log('ITM conversion OK:', r);
"
```

### End-to-end Socket.io test
```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2 — inject alert and watch it arrive
node -e "
  const { io } = require('socket.io-client');
  const s = io('http://localhost:3001', { transports: ['websocket'] });
  s.on('alert', a => { console.log('ALERT:', a); s.disconnect(); process.exit(0); });
  setTimeout(() => fetch('http://localhost:3001/api/alerts/mock', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ threatOrigin: 'Yemen', timeToImpact: 60 })
  }), 800);
"
```

---

## What NOT to Do

- **Do not skip the ITM → WGS84 conversion.** Shelters will appear in the wrong location.
- **Do not remove `socket.off()` from MapScreen cleanup.** Alerts will fire multiple times.
- **Do not use stale hook values inside socket/async callbacks.** Use `.getState()`.
- **Do not add keys to only one locale file.** All four files must stay in sync.
- **Do not use `gap` style on React Native < 0.71.** Current project uses 0.74 — safe.
- **Do not commit `.env` files or `node_modules/`.** Both are in `.gitignore`.
- **Do not call `injectMockAlert()` in production.** The route has a `NODE_ENV` guard.
- **Do not merge to `main` without verifying** `GET /api/shelters` returns valid coords.

---

## Known Limitations (planned for v2)

- GovMap Layer 417 WFS endpoint is reverse-engineered (not publicly documented).
  Verify it is still responding before each release.
- Pikud HaOref endpoint blocks requests from outside Israel (403). The backend
  proxy must be deployed in Israel or a compliant region.
- Language switch between RTL and LTR requires app restart — add `expo-updates`
  reload for production.
- Destination search is a mock geocoder. Replace with Google Places API.
- No push notification fallback (Expo Notifications) when WebSocket drops.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready, deployed |
| `claude/saferoute-israel-app-EJjbW` | Feature development (this branch) |

Merge to `main` only after:
1. All API endpoints return valid responses
2. ITM → WGS84 conversion test passes
3. Socket.io end-to-end alert test passes
4. No TypeScript errors (run `cd mobile && npx tsc --noEmit`)
