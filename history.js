// History recorder: polls m_get_my_device on the server and appends every new
// telemetry snapshot to data/history/<device_id>/<YYYY-MM-DD>.jsonl (device-local date).
// The session comes from the browser's own login / polling through the proxy;
// the password is never stored, so recording pauses once the token expires.
'use strict';

const fs = require('fs');
const path = require('path');

let DATA, HISTORY, SESSION_FILE;
function configure(dir) {
  DATA = dir;
  HISTORY = path.join(DATA, 'history');
  SESSION_FILE = path.join(DATA, 'session.json');
}
configure(path.join(__dirname, 'data'));
const POLL_MS = 60 * 1000;
const RETENTION_DAYS = 365;
const MAX_RANGE_S = 31 * 86400;
const MAX_GAP_S = 5 * 60; // longer gaps are not integrated into kWh
const VERIFIED_TTL_MS = 10 * 60 * 1000;

let session = null; // {userId, token, email}
const status = { active: false, lastPoll: null, lastError: null, tokenExpires: null };
const lastTime = new Map(); // device_id -> last recorded Time
const tz = new Map(); // device_id -> IANA time zone
const verified = new Map(); // token -> verified-at ms (tokens seen working through the proxy)
let notifier = null; // {snapshot(id, snap, device), tick(status)}, set by server.js (Telegram)
function setNotifier(n) { notifier = n; }

function tokenExpiry(token) {
  try {
    const exp = Number(Buffer.from(token, 'base64').toString('utf8').split(':')[1]);
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch { return null; }
}
const tokenUser = (token) => { try { return Buffer.from(token, 'base64').toString('utf8').split(':')[0]; } catch { return null; } };
const sessionAlive = () => !!session && (tokenExpiry(session.token) ?? Infinity) > Date.now();

function loadSession() {
  try {
    session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    status.tokenExpires = tokenExpiry(session.token);
  } catch { session = null; }
}

// Called by the proxy after a successful m_login / m_get_my_device.
function rememberSession(userId, token, email) {
  if (!userId || !token) return;
  verified.set(token, Date.now());
  if (session && session.token === token) return;
  // A token for another account must not replace the recorded one.
  if (session && String(session.userId) !== String(userId) && sessionAlive()) return;
  session = { userId: String(userId), token, email: email || session?.email || '' };
  status.tokenExpires = tokenExpiry(token);
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(session), { mode: 0o600 });
    fs.chmodSync(SESSION_FILE, 0o600);
  } catch (e) { console.error('history: cannot save session:', e.message); }
  if (!status.active) console.log('history: session received, recording resumes');
  status.active = true;
  status.lastError = null;
}

function localDate(unix, zone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(unix * 1000));
  } catch { return new Date(unix * 1000).toISOString().slice(0, 10); }
}
const dayFile = (id, date) => path.join(HISTORY, String(id).replace(/[^\w-]/g, ''), date + '.jsonl');

// The cloud has no grid power register. In Line (K1 = 4) or Bypass (5) mode the grid carries the load (K13 W)
// plus the battery charge (K6 x 0.1 V times K8 A), so G is that sum; otherwise 0. It is an estimate, not a reading.
function gridEstimate(r) {
  if (r.K1 !== 4 && r.K1 !== 5) return 0;
  return Math.round((r.K13 || 0) + ((r.K6 || 0) / 10) * (r.K8 || 0));
}

function readDay(id, date) {
  try {
    return fs.readFileSync(dayFile(id, date), 'utf8').split('\n').filter(Boolean).map((l) => {
      try { const r = JSON.parse(l); r.G = gridEstimate(r); return r; } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function record(json) {
  for (const d of json.devices || []) if (d.deviceTimeZone) tz.set(String(d.device_id), d.deviceTimeZone);
  for (const row of json.mas_powerstation || []) {
    const id = String(row.id_device);
    const t = Number(row.Time);
    if (!Number.isFinite(t)) continue;
    const date = localDate(t, tz.get(id));
    if (!lastTime.has(id)) {
      const prev = readDay(id, date).pop();
      lastTime.set(id, prev ? prev.t : 0);
    }
    if (t <= lastTime.get(id)) continue;
    const snap = { t };
    for (const [k, v] of Object.entries(row)) if (/^K\d+$/.test(k)) snap[k] = Number(v);
    const file = dayFile(id, date);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(snap) + '\n');
    lastTime.set(id, t);
    if (notifier) {
      const device = (json.devices || []).find((d) => String(d.device_id) === id);
      Promise.resolve(notifier.snapshot(id, snap, device, (json.devices || []).length)).catch((e) => console.error('notifier:', e.message));
    }
  }
}

async function poll(fetchUpstream) {
  if (notifier) Promise.resolve(notifier.tick({ active: sessionAlive() && status.active, tokenExpires: status.tokenExpires })).catch((e) => console.error('notifier:', e.message));
  if (!sessionAlive()) {
    if (status.active) console.log('history: token expired, recording paused until next login');
    status.active = false;
    if (session) status.lastError = 'token_expired';
    return;
  }
  status.lastPoll = Date.now();
  try {
    const json = await fetchUpstream('m_get_my_device', { user_id: session.userId, user_token: session.token, user_email: session.email }, session.token);
    const st = Number(json.status);
    if (st === 401 || st === 403) {
      status.active = false;
      status.lastError = 'session_rejected';
      console.log('history: server rejected the session, recording paused');
      return;
    }
    record(json);
    status.active = true;
    status.lastError = null;
  } catch (e) {
    status.lastError = e.message;
  }
}

function prune() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  let dirs = [];
  try { dirs = fs.readdirSync(HISTORY); } catch { return; }
  for (const dir of dirs) {
    for (const f of fs.readdirSync(path.join(HISTORY, dir))) {
      if (f.endsWith('.jsonl') && f.slice(0, 10) < cutoff) fs.unlinkSync(path.join(HISTORY, dir, f));
    }
  }
}

function start(fetchUpstream) {
  loadSession();
  status.active = sessionAlive();
  poll(fetchUpstream);
  setInterval(() => poll(fetchUpstream), POLL_MS).unref();
  prune();
  setInterval(prune, 86400 * 1000).unref();
}

// ---------- queries ----------

function datesBetween(fromUnix, toUnix) {
  // One day of slack on each side covers any device time zone.
  const out = [];
  for (let t = fromUnix - 86400; t <= toUnix + 86400; t += 86400) out.push(new Date(t * 1000).toISOString().slice(0, 10));
  return [...new Set(out)];
}

function range(id, from, to, step) {
  const rows = [];
  for (const date of datesBetween(from, to)) for (const r of readDay(id, date)) if (r.t >= from && r.t <= to) rows.push(r);
  rows.sort((a, b) => a.t - b.t);
  if (!step) return rows;
  // Average into buckets of `step` seconds.
  const buckets = new Map();
  for (const r of rows) {
    const b = Math.floor(r.t / step) * step;
    if (!buckets.has(b)) buckets.set(b, { n: 0, sum: {}, last: r });
    const acc = buckets.get(b);
    acc.n++;
    acc.last = r;
    for (const [k, v] of Object.entries(r)) if (k !== 't') acc.sum[k] = (acc.sum[k] || 0) + v;
  }
  return [...buckets].map(([t, { n, sum, last }]) => {
    const o = { t };
    for (const [k, v] of Object.entries(sum)) o[k] = Math.round((v / n) * 10) / 10;
    o.K1 = last.K1; // a mode code must not be averaged (3 and 4 would read as 3.5)
    return o;
  });
}

// Daily totals: Wh by trapezoid over consecutive snapshots, skipping gaps > MAX_GAP_S.
function days(id, fromDate, toDate) {
  const out = [];
  const end = new Date(toDate + 'T00:00:00Z');
  for (let d = new Date(fromDate + 'T00:00:00Z'); d <= end && out.length <= 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const rows = readDay(id, date);
    const day = { date, samples: rows.length, pvWh: 0, loadWh: 0, gridWh: 0, socMin: null, socMax: null };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (Number.isFinite(r.K7)) {
        day.socMin = day.socMin == null ? r.K7 : Math.min(day.socMin, r.K7);
        day.socMax = day.socMax == null ? r.K7 : Math.max(day.socMax, r.K7);
      }
      const p = rows[i - 1];
      if (!p || r.t - p.t > MAX_GAP_S) continue;
      const hours = (r.t - p.t) / 3600;
      const area = (k) => (((p[k] || 0) + (r[k] || 0)) / 2) * hours;
      day.pvWh += area('K5'); // K5 = PV input power
      day.loadWh += area('K13');
      day.gridWh += Math.max(0, area('G'));
    }
    for (const k of ['pvWh', 'loadWh', 'gridWh']) day[k] = Math.round(day[k]);
    out.push(day);
  }
  return out;
}

// Faults (K15 bits) and warnings (K16 bits) over the last `days` days as events {type, bit, from, to|null}.
// A bit that stays set across a recording gap longer than MAX_GAP_S is closed at the last sample before the gap.
function alertEvents(id, days) {
  const now = Math.floor(Date.now() / 1000);
  const rows = [];
  for (const date of datesBetween(now - days * 86400, now)) for (const r of readDay(id, date)) if (r.t >= now - days * 86400) rows.push(r);
  rows.sort((a, b) => a.t - b.t);
  const open = new Map(); // "fault:6" -> event
  const events = [];
  let prev = null;
  const close = (key, t) => { const e = open.get(key); if (e) { e.to = t; open.delete(key); } };
  for (const r of rows) {
    if (prev && r.t - prev.t > MAX_GAP_S) for (const key of [...open.keys()]) close(key, prev.t);
    const active = new Set();
    for (const [type, reg] of [['fault', 'K15'], ['warning', 'K16']]) {
      const v = Number(r[reg]) || 0;
      for (let i = 0; i < 16; i++) if (v & (1 << i)) active.add(`${type}:${i}`);
    }
    for (const key of active) if (!open.has(key)) {
      const [type, bit] = key.split(':');
      const e = { type, bit: Number(bit), from: r.t, to: null };
      open.set(key, e); events.push(e);
    }
    for (const key of [...open.keys()]) if (!active.has(key)) close(key, r.t);
    prev = r;
  }
  return events.sort((a, b) => b.from - a.from).slice(0, 300);
}

// Per-register maximum, minimum (each with its unix time) and time-weighted average for one day.
const EXTREME_KEYS = ['K2', 'K3', 'K5', 'K6', 'K7', 'K8', 'K12', 'K13', 'G'];
function extremes(id, date) {
  const rows = readDay(id, date);
  const keys = {};
  for (const k of EXTREME_KEYS) keys[k] = { max: null, min: null, avg: null, _sum: 0, _dur: 0 };
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    for (const k of EXTREME_KEYS) {
      const v = r[k];
      if (!Number.isFinite(v)) continue;
      const e = keys[k];
      if (!e.max || v > e.max.v) e.max = { v, t: r.t };
      if (!e.min || v < e.min.v) e.min = { v, t: r.t };
      if (prev && Number.isFinite(prev[k]) && r.t - prev.t <= MAX_GAP_S) {
        e._sum += ((prev[k] + v) / 2) * (r.t - prev.t);
        e._dur += r.t - prev.t;
      }
    }
  });
  for (const e of Object.values(keys)) {
    e.avg = e._dur ? Math.round((e._sum / e._dur) * 10) / 10 : null;
    delete e._sum; delete e._dur;
  }
  return { date, samples: rows.length, first: rows.length ? rows[0].t : null, keys };
}

// ---------- HTTP ----------

function authorised(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const token = m[1];
  if ((tokenExpiry(token) ?? Infinity) <= Date.now()) return false;
  const seen = verified.get(token);
  if (seen && Date.now() - seen < VERIFIED_TTL_MS) return !session || tokenUser(token) === String(session.userId);
  return !!session && token === session.token;
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// GET /history/status | /history/<id>?from&to&step | /history/<id>/days?from&to | /history/<id>/extremes?date | /history/<id>/alerts?days
function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (!authorised(req)) return send(res, 401, { error: 'unauthorized' });
  const parts = url.pathname.split('/').filter(Boolean); // ['history', ...]
  if (parts[1] === 'status') return send(res, 200, { ...status, recording: sessionAlive() && status.active });
  const id = parts[1];
  if (!id || !/^[\w-]+$/.test(id)) return send(res, 404, { error: 'not_found' });
  const q = url.searchParams;
  if (parts[2] === 'alerts') {
    const days = Math.min(90, Math.max(1, Number(q.get('days')) || 30));
    return send(res, 200, alertEvents(id, days));
  }
  if (parts[2] === 'extremes') {
    const date = q.get('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return send(res, 400, { error: 'bad_date' });
    return send(res, 200, extremes(id, date));
  }
  if (parts[2] === 'days') {
    const from = q.get('from'), to = q.get('to');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return send(res, 400, { error: 'bad_range' });
    return send(res, 200, days(id, from, to));
  }
  const from = Number(q.get('from')), to = Number(q.get('to')), step = Number(q.get('step')) || 0;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > MAX_RANGE_S) return send(res, 400, { error: 'bad_range' });
  return send(res, 200, range(id, from, to, step));
}

module.exports = { configure, start, rememberSession, record, handle, authorised, setNotifier };
