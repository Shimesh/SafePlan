/**
 * preview/server.js
 * Zero-dependency Node.js server.
 * Serves index.html on GET /
 * Proxies /api/* and /health to http://localhost:3001
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const BACKEND = 'http://localhost:3001';
const HTML_FILE = path.join(__dirname, 'index.html');

function proxyRequest(req, res) {
  const backendUrl = new URL(BACKEND + req.url);
  const options = {
    hostname: backendUrl.hostname,
    port: backendUrl.port || 80,
    path: backendUrl.pathname + backendUrl.search,
    method: req.method,
    headers: { ...req.headers, host: backendUrl.host },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Backend unavailable' }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url.startsWith('/api/') || url === '/health') {
    return proxyRequest(req, res);
  }

  if (url === '/' || url === '/index.html') {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('index.html not found');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Preview server running at http://localhost:${PORT}`);
  console.log('Proxying /api/* and /health → http://localhost:3001');
});
