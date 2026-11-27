'use strict';

/**
 * Twinslop Hands — сервер для телефонного контроллера «два стика = две руки».
 *
 * Без зависимостей. Умеет:
 *  - раздавать статику из ./web
 *  - принимать состояние рук от телефона:  POST /api/state
 *  - отдавать последнее состояние любому потребителю: GET /api/state
 *  - стримить изменения по SSE:            GET /api/stream
 *
 * Потребителем может быть что угодно: скрипт на ПК, мост в игру, OBS-плагин.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIR = path.join(__dirname, 'web');
const MAX_BODY = 16 * 1024;

const state = {
  ts: 0,
  seq: 0,
  L: { x: 0, y: 0, trigger: 0, grip: 0 },
  R: { x: 0, y: 0, trigger: 0, grip: 0 },
  meta: {},
};

const listeners = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of listeners) {
    try {
      res.write(line);
    } catch (_) {
      listeners.delete(res);
    }
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(WEB_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handle(req, res) {
  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    // кривой/относительный URL (например, "//") — не повод падать
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }
  // схлопываем двойные слэши: "//foo" и "/foo" — одно и то же
  const pathname = url.pathname.replace(/\/{2,}/g, '/');

  if (pathname === '/api/state' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return json(res, 400, { error: String(err.message || err) });
    }
    const hand = (h) => ({
      x: clamp(Number(h && h.x) || 0),
      y: clamp(Number(h && h.y) || 0),
      trigger: clamp(Number(h && h.trigger) || 0),
      grip: clamp(Number(h && h.grip) || 0),
    });
    state.L = hand(body.L);
    state.R = hand(body.R);
    state.meta = { sensitivity: body.sensitivity, deadzone: body.deadzone };
    state.ts = Date.now();
    state.seq += 1;
    broadcast(state);
    return json(res, 200, { ok: true, seq: state.seq });
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    return json(res, 200, { ...state, age_ms: state.ts ? Date.now() - state.ts : null });
  }

  if (pathname === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch (_) { /* ignore */ }
    }, 20000);
    const cleanup = () => {
      clearInterval(ping);
      listeners.delete(res);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    return;
  }

  if (pathname === '/healthz') return json(res, 200, { ok: true, seq: state.seq, uptime: process.uptime() });

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  return serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('handler error:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    else res.end();
  });
});

// последний рубеж: сервер не должен умирать из-за одного запроса
process.on('uncaughtException', (err) => console.error('uncaught:', err));

function clamp(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

server.listen(PORT, HOST, () => {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  console.log('\n  Twinslop Hands');
  console.log(`  локально:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  телефон:   http://${ip}:${PORT}`);
  console.log('  данные:    GET /api/state   поток: GET /api/stream\n');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
