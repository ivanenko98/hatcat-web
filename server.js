#!/usr/bin/env node
// HATCAT web monitor: static page + proxy to https://hatcat.eu/auth/*
// Node 18+, no dependencies.
//   node server.js            -> real API
//   MOCK=1 node server.js     -> demo data, no account needed
//   CAPTURE=1 node server.js  -> also save every API response to ./captures
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const history = require('./history');
const telegram = require('./telegram');
const limits = require('./limits');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = process.env.UPSTREAM || 'https://hatcat.eu/auth/';
const MOCK = process.env.MOCK === '1';
const CAPTURE = process.env.CAPTURE === '1';
const PUBLIC = path.join(__dirname, 'public');
const CAPTURES = path.join(__dirname, 'captures');

// Only read-only endpoints are proxied (monitoring only).
// Writing settings (m_set_new_settings) and Wi-Fi provisioning (m_add_new_dev) are never proxied.
// m_get_device_data always answers "session expired" (see docs/API.md), so it is not proxied either.
const ALLOWED = new Set([
  'm_login',
  'm_get_my_device',
  'm_get_device_settings',
  'm_register_user_and_send_code',
  'activate_account',
  'm_reset_password',
  'm_add_shared_dev',
]);
const UPSTREAM_TIMEOUT_MS = 15000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function capture(endpoint, reqBody, status, resBody) {
  if (!CAPTURE) return;
  try {
    fs.mkdirSync(CAPTURES, { recursive: true });
    const safeReq = reqBody.replace(/((?:user_|user_new_)?password=|verification_code=)[^&]*/g, '$1***');
    const file = path.join(CAPTURES, `${new Date().toISOString().replace(/[:.]/g, '-')}_${endpoint}.txt`);
    fs.writeFileSync(file, `REQUEST: ${safeReq}\nSTATUS: ${status}\n\n${resBody}\n`);
  } catch (e) {
    console.error('capture failed:', e.message);
  }
}

// hatcat.eu answers "Access denied!" unless the User-Agent looks like the Dart app.
async function upstream(endpoint, body, authorization) {
  if (MOCK) {
    return { status: 200, contentType: 'application/json; charset=utf-8', text: JSON.stringify(mockResponse(endpoint, new URLSearchParams(body))) };
  }
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: 'application/json, text/plain, */*',
    'user-agent': 'Dart/3.7 (dart:io)',
  };
  if (authorization) headers.authorization = authorization;
  const r = await fetch(UPSTREAM + endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  const text = await r.text();
  capture(endpoint, body, r.status, text);
  return { status: r.status, contentType: r.headers.get('content-type') || 'text/plain; charset=utf-8', text };
}

// Successful logins and device polls hand their session to the history recorder.
function observe(endpoint, body, text) {
  if (endpoint !== 'm_login' && endpoint !== 'm_get_my_device') return;
  let json;
  try { json = JSON.parse(text); } catch { return; }
  if (Number(json.status) !== 200) return;
  const params = new URLSearchParams(body);
  if (endpoint === 'm_login') {
    history.rememberSession(json.user_id, json.user_token, params.get('user_email'));
  } else {
    history.rememberSession(params.get('user_id'), params.get('user_token'), params.get('user_email'));
    history.record(json);
  }
}

async function proxy(endpoint, req, res) {
  const body = await readBody(req);
  try {
    const r = await upstream(endpoint, body, req.headers.authorization);
    try { observe(endpoint, body, r.text); } catch (e) { console.error('history:', e.message); }
    res.writeHead(r.status, { 'content-type': r.contentType });
    res.end(r.text);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_unreachable', message: e.message }));
  }
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      // Code and markup revalidate every time; images and fonts never change.
      'cache-control': /\.(webp|png|ttf|svg)$/.test(ext) ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  try {
    const m = req.url.match(/^\/api\/([a-z_]+)$/);
    if (m) {
      if (req.method !== 'POST' || !ALLOWED.has(m[1])) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'endpoint_not_allowed' }));
        return;
      }
      await proxy(m[1], req, res);
      return;
    }
    if (/^\/limits$/.test(req.url)) {
      if (!history.authorised(req)) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
      await limits.handle(req, res, readBody);
      return;
    }
    if (/^\/telegram(\/|$)/.test(req.url)) {
      if (!history.authorised(req)) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return; }
      await telegram.handle(req, res, readBody);
      return;
    }
    if (req.method === 'GET' && /^\/history(\/|$)/.test(req.url)) { history.handle(req, res); return; }
    if (req.method === 'GET') { serveStatic(req, res); return; }
    res.writeHead(405); res.end();
  } catch (e) {
    res.writeHead(500); res.end(String(e.message));
  }
}).listen(PORT, HOST, () => {
  // Mock data goes to its own folder so it never mixes with real history.
  history.configure(path.join(__dirname, MOCK ? 'data-mock' : 'data'));
  limits.configure(path.join(__dirname, MOCK ? 'data-mock' : 'data'));
  telegram.configure(path.join(__dirname, MOCK ? 'data-mock' : 'data'));
  history.setNotifier({ snapshot: telegram.snapshot, tick: telegram.tick });
  history.start(async (endpoint, params, token) => JSON.parse((await upstream(endpoint, new URLSearchParams(params).toString(), 'Bearer ' + token)).text));
  console.log(`HATCAT web monitor: http://${HOST}:${PORT}  ${MOCK ? '(MOCK data)' : '-> ' + UPSTREAM}${CAPTURE ? '  [capturing to ./captures]' : ''}`);
});

// ---------- demo data ----------
function mockResponse(endpoint, params) {
  if (endpoint === 'm_login') {
    if (!params.get('user_email')) return { status: 400, message: 'Empty email' };
    // Same shape as a real token: base64("<user_id>:<expires_unix>:<hmac>"), valid for a week.
    const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
    return { status: 200, user_id: 76, user_token: Buffer.from(`76:${exp}:mockmockmock`).toString('base64') };
  }
  if (endpoint === 'm_get_my_device') {
    // Same shape as the real hatcat.eu response.
    const t = Date.now() / 60000;
    const load = process.env.MOCK_LOAD ? Number(process.env.MOCK_LOAD) : Math.round(560 + 120 * Math.sin(t / 2));
    const pv = process.env.MOCK_PV !== undefined ? Number(process.env.MOCK_PV) : Math.max(0, Math.round(900 + 700 * Math.sin(t / 3)));
    const batV = 52.1;
    // Alternates every two minutes between battery mode (K1 = 3) and grid mode (K1 = 4, charging at 40 A).
    const gridOn = process.env.MOCK_MODE ? process.env.MOCK_MODE === 'grid' : Math.floor(Date.now() / 120000) % 2 === 0; // MOCK_MODE=grid|battery pins it
    const net = pv - load; // >0 charging
    const chargeA = gridOn ? 40 : (net > 0 ? Math.round(net / batV) : 0);
    const dischargeA = gridOn ? 0 : (net < 0 ? Math.round(-net / batV) : 0);
    return {
      status: 200,
      message: 'Data received successfully',
      devices: [{ device_id: '64', created_at: '2026-10-28 14:09:27', name: null, mac_address: '74E9D8092A6E', dev_type: '1', deviceTimeZone: 'Europe/Kyiv' }],
      mas_powerstation: [{
        id_device: '64', Time: String(Math.floor(Date.now() / 1000) - 20),
        K1: gridOn ? '4' : '3', K2: gridOn ? '2201' : '0', K3: gridOn ? '500' : '0', K4: '0', K5: String(pv), K6: String(Math.round(batV * 10)), K7: '63', K8: String(chargeA),
        K9: String(dischargeA),
        K10: gridOn ? '2201' : '2301', K11: '500', K12: String(Math.round(load * 1.12)), K13: String(load), K14: String(Math.round(load / 40)),
        K15: process.env.MOCK_ALERTS ? '65' : '0', K16: process.env.MOCK_ALERTS ? '33' : '0', K17: gridOn ? '1378' : '1089', K18: '0', K19: '33', K20: '0', // MOCK_ALERTS=1: faults FanBlocked + Overload, warnings FanBlocked + WeakPVPower
        K31: '213', K32: '210', K33: '326', K34: '324', K35: '240', K36: '232',
      }],
      mas_battery: [],
      mas_battery_new: [],
    };
  }
  if (endpoint === 'm_get_device_settings') {
    // Real values from device 64 (see docs/API.md).
    const P = '0 440 15001 0 2 4200 4200 230 18 480 230 500 18 1 1 0 4 0 40 230 40 480 540 552 520 460 584 60 120 30 0 5 1 0'.split(' ');
    const mas = {};
    P.forEach((v, i) => { mas['P' + (i + 1)] = v; });
    Object.assign(mas, { P36: '0', P37: '1', P38: '0', P39: '0', P40: '1', P41: '1', P42: '0', P43: '33', P44: '5', P45: '95', P46: '50', P47: '10', P48: '105', P65535: String(Math.floor(Date.now() / 1000) - 3600) });
    return { status: 200, message: 'Data received successfully', mas_settings: mas };
  }
  return { status: 'error' };
}
