# SafeRoute Israel 🇮🇱🛡️

A life-saving GPS navigation app for Israeli civilians. During a missile alert (Pikud HaOref), it **instantly auto-reroutes the driver to the nearest bomb shelter** with a live countdown and ETA.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  MOBILE APP (Expo RN)                   │
│  ChecklistScreen ──► MapScreen                          │
│  Zustand: navigationStore | alertStore | shelterStore   │
│  Socket.io-client  (real-time Pikud HaOref alerts)      │
│  react-i18next     (he / en / ru / ar, RTL/LTR)         │
│  react-native-maps (Google Maps + Directions API)       │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP + WebSocket
┌────────────────────────▼────────────────────────────────┐
│               BACKEND  (Node.js + Express)              │
│  /api/shelters  ──► GovMap Layer 417 (ITM → WGS84)     │
│  /api/alerts    ──► Pikud HaOref polling (2 s)          │
│  Socket.io      ──► push 'alert' events to clients      │
└────────────┬─────────────────────────┬──────────────────┘
             │                         │
    ┌────────▼──────────┐   ┌──────────▼──────────────┐
    │  GovMap WFS API   │   │  Pikud HaOref alerts.json│
    │  (Layer 417, ITM) │   │  oref.org.il             │
    └───────────────────┘   └──────────────────────────┘
```

---

## Project Structure

```
SafePlan/
├── backend/                         # Node.js + Express server
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── server.js                # Express + Socket.io entry point
│       ├── routes/
│       │   ├── alerts.js            # GET /api/alerts/current, POST /api/alerts/mock
│       │   └── shelters.js          # GET /api/shelters, /nearest, POST /refresh
│       ├── services/
│       │   ├── govmapService.js     # Fetches & caches GovMap Layer 417
│       │   └── pikudHaorefService.js# Polls oref.org.il, emits Socket.io events
│       └── utils/
│           └── coordinateConverter.js # ITM (EPSG:2039) → WGS84 via proj4
└── mobile/                          # Expo React Native TypeScript app
    ├── .env.example
    ├── app.json
    ├── App.tsx                      # Root: i18n init, RTL gate, navigator
    ├── babel.config.js
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── types.ts                 # Shared: LatLng, Shelter, Alert
        ├── navigation/
        │   └── AppNavigator.tsx     # Stack: Checklist → Map
        ├── screens/
        │   ├── ChecklistScreen.tsx  # Pre-departure readiness UI
        │   └── MapScreen.tsx        # Map + route + emergency mode
        ├── components/
        │   ├── EmergencyBanner.tsx  # Full-width red alert overlay
        │   ├── ShelterMarker.tsx    # Custom Google Maps marker
        │   └── ShelterList.tsx      # Horizontal shelter card list
        ├── store/
        │   ├── alertStore.ts        # Emergency state (Zustand)
        │   ├── navigationStore.ts   # Route / GPS state (Zustand)
        │   └── shelterStore.ts      # Shelter list (Zustand)
        ├── services/
        │   ├── api.ts               # Axios client → backend
        │   ├── mapsService.ts       # Google Directions API + polyline decode
        │   └── socketService.ts     # Socket.io singleton
        ├── utils/
        │   ├── haversine.ts         # Great-circle distance + nearest shelter
        │   └── mockData.ts          # Rosh HaAyin → Sharon test scenario
        └── i18n/
            ├── index.ts             # i18next init + language detector
            └── locales/
                ├── he.json          # Hebrew  (DEFAULT, RTL)
                ├── en.json          # English (LTR)
                ├── ru.json          # Russian (LTR)
                └── ar.json          # Arabic  (RTL)
```

---

## Quick Start

### Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 18.x |
| npm | 9.x |
| Expo CLI | `npm i -g expo-cli` |
| Google Maps API key | Maps SDK + Directions API enabled |

---

### 1 — Backend

```bash
cd backend
cp .env.example .env          # fill in your values
npm install
npm run dev                   # nodemon → http://localhost:3001
```

Verify it is running:
```bash
curl http://localhost:3001/health
# {"status":"ok","uptime":...,"connectedClients":0}

curl http://localhost:3001/api/shelters
# {"success":true,"count":6,"shelters":[...]}
```

---

### 2 — Mobile

```bash
cd mobile
cp .env.example .env          # set EXPO_PUBLIC_GOOGLE_MAPS_KEY and EXPO_PUBLIC_BACKEND_URL
npm install
npx expo start                # scan QR with Expo Go app
```

For a physical device on the same network, set:
```
EXPO_PUBLIC_BACKEND_URL=http://<your-lan-ip>:3001
```

---

### 3 — Trigger a Mock Emergency (Demo)

**Option A — HTTP (fastest):**
```bash
curl -X POST http://localhost:3001/api/alerts/mock \
  -H "Content-Type: application/json" \
  -d '{"threatOrigin":"Iran","timeToImpact":90}'
```

**Option B — Auto-trigger in app:**
Set `EXPO_PUBLIC_MOCK_MODE=true` in `mobile/.env`.
The alert fires automatically **60 seconds** after navigation starts,
simulating the Rosh HaAyin → Sharon scenario.

---

## Key Implementation Notes

### ITM → WGS84 Coordinate Conversion

GovMap Layer 417 returns shelter coordinates in **Israel Transverse Mercator (ITM, EPSG:2039)**.
Google Maps requires **WGS84 lat/lng**. The conversion lives in
`backend/src/utils/coordinateConverter.js` using the `proj4` library:

```js
// Jerusalem city center example
itmToWgs84(219143.61, 618345.06)
// → { lat: 31.7683, lng: 35.2137 }
```

EPSG:2039 proj4 string (official EPSG registry):
```
+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444
+k=1.0000067 +x_0=219529.584 +y_0=626907.39
+ellps=GRS80 +towgs84=-48,55,52,0,0,0,0 +units=m +no_defs
```

### Internationalization (i18n) & RTL

| Language | Code | Direction |
|----------|------|-----------|
| Hebrew (default) | `he` | RTL |
| English | `en` | LTR |
| Russian | `ru` | LTR |
| Arabic | `ar` | RTL |

Direction is applied at startup in `App.tsx` via `I18nManager.forceRTL()`.
A language switch between RTL and LTR directions requires an **app restart**.

### Real-Time Alert Flow

```
Backend polls oref.org.il every 2 s
  │
  ├── No change → nothing emitted
  └── New alert ID detected
        ├── Emit Socket.io 'alert' to all connected clients
        └── Mobile receives event
              ├── findNearestShelter() — O(n) Haversine scan
              ├── getRoute()           — Google Directions API
              ├── activateEmergency()  — Zustand store update
              └── EmergencyBanner renders with live countdown
```

### Emergency Banner

| Property | Value |
|----------|-------|
| Position | Absolute overlay, z-index 999, slides in from top |
| Background | `#B71C1C` deep red, pulses for first 10 s |
| Countdown colour | Yellow (>60 s) → Orange (30–60 s) → Bright Red (<30 s) |
| Haptics | Vibration burst on appearance |

---

## Mock Test Scenario: Rosh HaAyin → Sharon

| Time | Event |
|------|-------|
| T+0 s | Checklist screen shown |
| T+30 s | User completes ≥4 items, taps "Start Drive" |
| T+60 s | Alert fires: **"Threat from Iran"**, 90 s to impact |
| T+61 s | Nearest shelter found → shelter route fetched → EmergencyBanner shown |
| T+90 s | Countdown reaches 0 |

Route waypoints:
```
Rosh HaAyin  32.0956, 34.9574
Hod HaSharon 32.1526, 34.9067
Kfar Saba    32.1784, 34.9038
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health |
| GET | `/api/shelters` | All shelters (WGS84) |
| GET | `/api/shelters/nearest?lat=&lng=&limit=5` | N nearest shelters |
| POST | `/api/shelters/refresh` | Clear shelter cache |
| GET | `/api/alerts/current` | Current alert or null |
| POST | `/api/alerts/mock` | Inject test alert (dev only) |

**Socket.io event emitted by server:**

```json
{
  "event": "alert",
  "payload": {
    "id": "string",
    "title": "string",
    "threatOrigin": "Iran | Gaza | Lebanon | Yemen | ...",
    "regions": ["שרון", "גוש דן"],
    "timeToImpact": 90,
    "category": 4,
    "timestamp": "2026-04-03T12:00:00.000Z"
  }
}
```

---

## Production Checklist

- [ ] Restrict Google Maps API key to bundle ID (iOS) and SHA-1 (Android)
- [ ] Set `EXPO_PUBLIC_BACKEND_URL` to deployed backend URL
- [ ] Set `NODE_ENV=production` on backend (disables mock endpoint)
- [ ] Add `expo-updates` → call `Updates.reloadAsync()` after RTL language switch
- [ ] Implement Google Places geocoding for the destination search input
- [ ] Add Expo Push Notifications as a WebSocket fallback
- [ ] Test with real Pikud HaOref drill alerts before release
- [ ] Verify GovMap Layer 417 WFS endpoint is still active before each release

---

## License

Built for life-safety purposes. Use responsibly.
