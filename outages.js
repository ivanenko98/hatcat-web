// Planned outage schedule (ГПВ) of the Poltava grid operator, refreshed every 30 minutes.
// Source: the operator's own page "Інформація про перерви в електропостачанні" calls POST /customs/newgpv-info.php
// with {"date_in":"DD-MM-YYYY"} and gets HTML: a table with 48 half-hour cells per queue (gpv-s1 on, gpv-s2 off,
// gpv-s3 switching) and, when emergency measures apply, /customs/unloading-info.php lists them as JSON.
// robots.txt of poe.pl.ua does not disallow these paths; we ask politely (2 + 1 requests per 30 minutes, own User-Agent).
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = process.env.OUTAGES_BASE || 'https://www.poe.pl.ua';
const TZ = 'Europe/Kyiv';
const REFRESH_MS = 30 * 60 * 1000;
const STALE_MS = 3 * 3600 * 1000; // older data is not trusted for alerts
const UA = 'hatcat-web-monitor/1.0 (personal use, 3 requests per 30 minutes)';
const QUEUES = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];
const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
const ON = 1, OFF = 2, SWITCH = 3;

let DATA = path.join(__dirname, 'data');
let cfg = { queue: '5.1' };
let cache = { updatedAt: 0, error: null, days: {}, emergency: [] };
let timer = null;

// ---------- storage ----------

function configure(dir) {
  DATA = dir;
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(DATA, 'outages.json'), 'utf8'))); } catch { /* defaults */ }
  if (!QUEUES.includes(cfg.queue)) cfg.queue = '5.1';
  try { cache = { ...cache, ...JSON.parse(fs.readFileSync(path.join(DATA, 'outages-cache.json'), 'utf8')) }; } catch { /* nothing cached yet */ }
}
function saveCache() {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, 'outages-cache.json'), JSON.stringify(cache)); } catch { /* best effort */ }
}
function setQueue(q) {
  if (!QUEUES.includes(q)) throw new Error('bad_queue');
  cfg.queue = q;
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'outages.json'), JSON.stringify(cfg));
}

// ---------- time in the grid operator's zone ----------

// {date: 'YYYY-MM-DD', minutes: minutes since local midnight} for a unix time.
function localParts(unix) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(unix * 1000)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const dmy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const hm = (cell) => `${String(Math.floor(cell / 2)).padStart(2, '0')}:${cell % 2 ? '30' : '00'}`;

// ---------- parsing ----------

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// One day's block. Returns null when the response has no schedule for `iso`.
function parseDay(html, iso) {
  const body = html.replace(/<style[\s\S]*?<\/style>/g, '');
  const first = body.indexOf('<table');
  // The text announces the date; a response for another day must not be taken for this one.
  const intro = text(body.slice(0, first === -1 ? body.length : first));
  const dm = intro.match(/(\d{1,2})\s+(\S+)\s+(\d{4})\s+року/);
  if (dm) {
    const month = MONTHS.indexOf(dm[2]) + 1;
    const found = `${dm[3]}-${String(month).padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    if (month && found !== iso) return null;
  }
  if (/не плануємо застосовувати/i.test(intro) && first === -1) return { date: iso, none: true, volumes: [], queues: Object.fromEntries(QUEUES.map((q) => [q, Array(48).fill(ON)])) };
  if (first === -1) return null;

  const volumes = [...intro.matchAll(/з (\d\d:\d\d) по (\d\d:\d\d) застосовується ГПВ в обсязі ([\d.,]+) черги/g)]
    .map((m) => ({ from: m[1], to: m[2], queues: Number(m[3].replace(',', '.')) }));

  const queues = {};
  const grid = body.match(/<table[\s\S]*?<\/table>/g) || [];
  for (const table of grid) {
    for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const cells = [...row.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/g)];
      if (!cells.length) continue;
      const label = text(cells[0][2]);
      if (!QUEUES.includes(label) || queues[label]) continue;
      const states = cells.slice(1).map((c) => { const m = c[1].match(/gpv-s(\d)/); return m ? Number(m[1]) : 0; });
      if (states.length === 48 && states.every((v) => v >= 1 && v <= 3)) queues[label] = states;
    }
    if (Object.keys(queues).length) break; // the first grid belongs to this day, later ones to the next
  }
  if (Object.keys(queues).length < QUEUES.length) return null;
  return { date: iso, none: false, volumes, queues };
}

// [{from, to, kind}] runs of off (2) and switching (3) cells, e.g. 07:00–08:30.
function windows(cells) {
  const out = [];
  let start = null, kind = null;
  for (let i = 0; i <= 48; i++) {
    const v = i < 48 ? cells[i] : 0;
    const k = v === OFF ? 'off' : v === SWITCH ? 'switch' : null;
    if (k !== kind) {
      if (kind) out.push({ from: hm(start), to: i === 48 ? '24:00' : hm(i), kind });
      start = i; kind = k;
    }
  }
  return out;
}

// ---------- fetching ----------

async function post(endpoint, iso) {
  const r = await fetch(BASE + endpoint, {
    method: 'POST',
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', referer: BASE + '/disconnection/power-outages/' },
    body: 'seldate=' + encodeURIComponent(JSON.stringify({ date_in: dmy(iso) })),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${endpoint} HTTP ${r.status}`);
  return r.text();
}

async function refresh() {
  const today = localParts(Math.floor(Date.now() / 1000)).date;
  const wanted = [today, addDays(today, 1)];
  const days = {};
  let error = null;
  for (const iso of wanted) {
    try {
      const d = parseDay(await post('/customs/newgpv-info.php', iso), iso);
      if (d) days[iso] = { ...d, fetchedAt: Date.now() };
    } catch (e) { error = e.message; }
  }
  let emergency = cache.emergency;
  try {
    const raw = await post('/customs/unloading-info.php', today);
    emergency = JSON.parse(raw).filter((u) => Number(u.unloadingtypeid) === 1) // 1 = emergency outages (ГАВ)
      .map((u) => ({ date: u.unloaddata.split('-').reverse().join('-'), from: u.beginhour * 60 + u.beginminute, to: u.endhour * 60 + u.endminute, note: u.note || '' }));
  } catch (e) { if (!(e instanceof SyntaxError)) error = error || e.message; else emergency = []; }
  if (Object.keys(days).length) { cache = { updatedAt: Date.now(), error, days: { ...pruned(days), ...days }, emergency }; } else cache = { ...cache, error: error || 'no_schedule' };
  saveCache();
  return cache;
}
// Keep yesterday as well (the last cells of the previous day matter right after midnight).
function pruned(fresh) {
  const keep = {};
  const today = localParts(Math.floor(Date.now() / 1000)).date;
  for (const [iso, d] of Object.entries(cache.days || {})) if (iso >= addDays(today, -1) && !fresh[iso]) keep[iso] = d;
  return keep;
}

function start() {
  refresh().catch((e) => console.error('outages: refresh failed:', e.message));
  timer = setInterval(() => refresh().catch((e) => console.error('outages: refresh failed:', e.message)), REFRESH_MS);
  timer.unref();
}

// ---------- queries ----------

const fresh = () => Date.now() - cache.updatedAt < STALE_MS;

// 'on' | 'off' | 'switch' | null (unknown: no data for that moment or data too old).
function stateAt(unix, queue = cfg.queue) {
  if (!fresh()) return null;
  const { date, minutes } = localParts(unix);
  const day = cache.days[date];
  if (!day || !day.queues[queue]) return null;
  return ['on', 'off', 'switch'][day.queues[queue][Math.floor(minutes / 30)] - 1] || null;
}

function emergencyAt(unix) {
  const { date, minutes } = localParts(unix);
  return (cache.emergency || []).some((e) => e.date === date && minutes >= e.from && minutes <= e.to);
}

// What the schedule says at `unix` plus when that state started and ends (HH:MM, null = beyond the known data).
function describe(unix, queue = cfg.queue) {
  const state = stateAt(unix, queue);
  if (!state) return { state: null, queue };
  let since = null, until = null;
  for (let t = unix; t > unix - 24 * 3600; t -= 1800) { if (stateAt(t - 1800, queue) !== state) { since = t; break; } }
  for (let t = unix; t < unix + 24 * 3600; t += 1800) { const s = stateAt(t + 1800, queue); if (s !== state) { until = s === null ? null : t + 1800; break; } }
  const clock = (u) => { const p = localParts(u); const h = Math.floor(p.minutes / 60), m = p.minutes % 60; return `${String(h).padStart(2, '0')}:${String(Math.floor(m / 30) * 30).padStart(2, '0')}`; };
  return { state, queue, since: since ? clock(since) : null, until: until ? clock(until) : null, emergency: emergencyAt(unix) };
}

// ---------- HTTP ----------

function view() {
  const days = Object.entries(cache.days).sort().map(([date, d]) => ({
    date, none: d.none, volumes: d.volumes, cells: d.queues[cfg.queue], windows: windows(d.queues[cfg.queue]),
  }));
  return { queue: cfg.queue, queues: QUEUES, tz: TZ, updatedAt: cache.updatedAt, stale: !fresh(), error: cache.error, emergency: cache.emergency || [], days };
}

// GET /outages, POST /outages {queue}. The caller has already checked the session.
async function handle(req, res, readBody) {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET') return send(200, view());
  if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' });
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    setQueue(String(body.queue));
    return send(200, view());
  } catch (e) { return send(400, { error: e.message === 'bad_queue' ? 'bad_queue' : 'bad_request' }); }
}

module.exports = { configure, start, refresh, handle, stateAt, describe, emergencyAt, queue: () => cfg.queue, _test: { parseDay, windows, localParts, setCache: (c) => { cache = c; }, getCache: () => cache, QUEUES } };
