/**
 * server.js – SafeRoute Israel Backend
 *
 * Responsibilities:
 *  1. Serve REST endpoints (/api/shelters, /api/alerts) as a CORS-enabled
 *     proxy so the mobile app can access Israeli government APIs that
 *     geo-block direct browser/app requests.
 *  2. Run a Socket.io server that pushes real-time Pikud HaOref alerts to
 *     every connected mobile client within milliseconds of detection.
 *  3. Continuously poll the Pikud HaOref alert feed (every 2 s by default).
 *
 * Architecture:
 *   Express HTTP server
 *     ├── /api/shelters  (shelters router)
 *     └── /api/alerts    (alerts router)
 *   Socket.io (attached to the same HTTP server)
 *     └── emits: 'alert' { id, threatOrigin, regions, timeToImpact, timestamp }
 */

'use strict';

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const { Server } = require('socket.io');

const sheltersRouter         = require('./routes/shelters');
const alertsRouter           = require('./routes/alerts');
const { startPolling }       = require('./services/pikudHaorefService');

// ─── App & HTTP server ───────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3001;

// ─── Socket.io ───────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    // Allow connections from the Expo dev client and production mobile clients
    origin: [
      process.env.MOBILE_ORIGIN || 'exp://localhost:8081',
      'http://localhost:8081',
      'http://localhost:19000',
      'http://localhost:19006',
    ],
    methods: ['GET', 'POST'],
  },
  // Reduce connection overhead for mobile clients on cellular networks
  pingTimeout: 20000,
  pingInterval: 25000,
});

// Give the alerts router a reference to the Socket.io instance so it can
// broadcast mock alerts during development.
alertsRouter.setIO(io);

// ─── Socket.io connection logging ────────────────────────────────────────
io.on('connection', (socket) => {
  const addr = socket.handshake.address;
  console.log(`[socket] Client connected: ${socket.id} from ${addr}`);

  socket.on('disconnect', (reason) => {
    console.log(`[socket] Client disconnected: ${socket.id} – reason: ${reason}`);
  });

  // Client can request current alert status on connect
  socket.on('requestCurrentAlert', async () => {
    const { fetchCurrentAlert } = require('./services/pikudHaorefService');
    const alert = await fetchCurrentAlert();
    if (alert) socket.emit('alert', alert);
  });
});

// ─── Middleware ───────────────────────────────────────────────────────────
app.use(cors({
  origin: '*', // Locked down per-route where needed; mobile app is the sole consumer
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-secret'],
}));
app.use(express.json());

// Request logger (lightweight – avoid heavy logging libs for this service)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────
app.use('/api/shelters', sheltersRouter);
app.use('/api/alerts',   alertsRouter);

// Health-check endpoint for load balancers / uptime monitors
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    connectedClients: io.engine.clientsCount,
  });
});

// 404 catch-all
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found.' });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ─── Start ────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 SafeRoute Israel backend running on port ${PORT}`);
  console.log(`   REST API : http://localhost:${PORT}/api`);
  console.log(`   Health   : http://localhost:${PORT}/health`);
  console.log(`   Sockets  : ws://localhost:${PORT}\n`);

  // Start polling Pikud HaOref immediately after server is up
  startPolling(io);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────
const { stopPolling } = require('./services/pikudHaorefService');
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received – shutting down gracefully…');
  stopPolling();
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  stopPolling();
  server.close(() => process.exit(0));
});
