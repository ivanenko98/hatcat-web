// Input breaker limits and the grid current estimate, shared by the web UI (GET/POST /limits) and Telegram.
// The cloud has no grid current register, so the current is estimated from what the station reports (see gridAmps).
'use strict';

const fs = require('fs');
const path = require('path');

// inverterW: rated output of the ESSM-4.2KW station (datasheet: 4200 W; stable to 4494 W, 6300 W for 5 s, 7630 W for 3 s).
const DEFAULTS = { breakerA: 25, warnPct: 80, alarmPct: 95, inverterW: 4200 };
const CHARGER_EFF = 0.93; // grid power needed per watt that reaches the battery
let DATA = path.join(__dirname, 'data');
let limits = { ...DEFAULTS };

function sanitize(j) {
  const n = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  const breakerA = n(j.breakerA, 6, 125, DEFAULTS.breakerA);
  const warnPct = n(j.warnPct, 50, 99, DEFAULTS.warnPct);
  const alarmPct = Math.min(100, Math.max(warnPct + 1, n(j.alarmPct, 51, 100, DEFAULTS.alarmPct)));
  const inverterW = n(j.inverterW, 500, 20000, DEFAULTS.inverterW);
  return { breakerA, warnPct, alarmPct, inverterW };
}

function load() {
  try { limits = sanitize(JSON.parse(fs.readFileSync(path.join(DATA, 'limits.json'), 'utf8'))); } catch { limits = { ...DEFAULTS }; }
}
function configure(dir) { DATA = dir; load(); }
const get = () => ({ ...limits });

function set(patch) {
  limits = sanitize({ ...limits, ...patch });
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'limits.json'), JSON.stringify(limits));
  return get();
}

// Amps the grid supplies: output apparent power plus what goes into the battery, over the grid voltage.
// Only Line (K1 = 4) and Bypass (5) draw from the grid; on battery power it is 0. Mirrors gridAmps() in public/js/regs.js.
function gridAmps(s) {
  const volts = (s.K2 || 0) / 10;
  if (volts < 100 || (s.K1 !== 4 && s.K1 !== 5)) return 0;
  const va = s.K12 || s.K13 || 0;
  const chargeW = ((s.K6 || 0) / 10) * (s.K8 || 0);
  return Math.round(((va + chargeW / CHARGER_EFF) / volts) * 10) / 10;
}

// 0 = fine, 1 = high (warn threshold), 2 = about to trip (alarm threshold), for any value against its maximum.
const levelOf = (value, max, lim) => (value >= (max * lim.alarmPct) / 100 ? 2 : value >= (max * lim.warnPct) / 100 ? 1 : 0);
const level = (amps, lim = limits) => levelOf(amps, lim.breakerA, lim); // grid current against the main breaker

// Apparent power the station is delivering (VA): what the inverter rating limits, on battery or in bypass.
const outputVA = (s) => s.K12 || s.K13 || 0;
const outputLevel = (s, lim = limits) => levelOf(outputVA(s), lim.inverterW, lim);

// Grid charge current (program 11) that keeps load plus charge under the warn threshold of the breaker, rounded down to 5 A.
// null when the grid or battery voltage is unknown.
function recommendedChargeA(s, lim = limits) {
  const gridV = (s.K2 || 0) / 10, batV = (s.K6 || 0) / 10;
  if (gridV < 100 || batV <= 0) return null;
  const spareVA = (lim.breakerA * gridV * lim.warnPct) / 100 - outputVA(s);
  return Math.max(0, Math.floor((spareVA * CHARGER_EFF) / batV / 5) * 5);
}

// GET /limits, POST /limits {breakerA?, warnPct?, alarmPct?}. The caller has already checked the session.
async function handle(req, res, readBody) {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET') return send(200, get());
  if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return send(400, { error: 'bad_json' }); }
  return send(200, set(body));
}

module.exports = { configure, get, set, gridAmps, level, levelOf, outputVA, outputLevel, recommendedChargeA, handle, DEFAULTS };
