/**
 * routes/alerts.js
 *
 * GET /api/alerts/current
 *   Returns the current Pikud HaOref alert (if any), or null.
 *   Useful for clients that poll via HTTP rather than WebSocket.
 *
 * POST /api/alerts/mock  (dev only)
 *   Injects a mock alert and broadcasts it to all Socket.io clients.
 *   Use this during development/demo to simulate an emergency without waiting
 *   for a real alert (e.g., the Rosh HaAyin → Sharon test scenario).
 *
 *   Body: { threatOrigin: "Iran", timeToImpact: 90 }
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const { fetchCurrentAlert, injectMockAlert } = require('../services/pikudHaorefService');

// io is attached to the router by server.js after Socket.io is initialized
let _io = null;
router.setIO = (io) => { _io = io; };

// ─── GET /api/alerts/current ─────────────────────────────────────────────
router.get('/current', async (req, res) => {
  try {
    const alert = await fetchCurrentAlert();
    res.json({ success: true, alert }); // alert is null if no active alert
  } catch (err) {
    console.error('[/api/alerts/current] Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch alert status.' });
  }
});

// ─── POST /api/alerts/mock  (dev / demo) ─────────────────────────────────
router.post('/mock', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, error: 'Mock alerts disabled in production.' });
  }

  if (!_io) {
    return res.status(500).json({ success: false, error: 'Socket.io not initialized.' });
  }

  const {
    threatOrigin      = 'ירי רקטות — עזה',
    timeToImpact      = 90,
    alertType         = 'active',
    warningTimeSeconds = 0,
  } = req.body || {};

  injectMockAlert(_io, String(threatOrigin), Number(timeToImpact), alertType, Number(warningTimeSeconds));

  res.json({
    success: true,
    message: `Mock alert injected: ${threatOrigin} with ${timeToImpact}s to impact.`,
  });
});

module.exports = router;
