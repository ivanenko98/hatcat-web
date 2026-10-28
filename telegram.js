// Telegram notifications. The history poller hands every new telemetry snapshot to snapshot() and calls tick()
// once a minute; this module turns state changes into messages for ONE chat that was paired with a one-time code.
// Config (bot token, chat id, switches) lives in data/telegram.json (0600); the token never leaves the server.
'use strict';

const fs = require('fs');
const path = require('path');
const limits = require('./limits');
const outages = require('./outages');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

let DATA = path.join(__dirname, 'data');
const file = (n) => path.join(DATA, n);
const API_BASE = () => process.env.TELEGRAM_API || 'https://api.telegram.org';

const EVENT_KEYS = ['faults', 'warnings', 'cleared', 'grid', 'outage', 'gridLoad', 'outputLoad', 'battery', 'offline', 'session'];
const DEFAULTS = () => ({ token: '', botName: '', chatId: null, chatName: '', enabled: false, lang: 'uk', events: Object.fromEntries(EVENT_KEYS.map((k) => [k, true])) });

const BATTERY_STEPS = [20, 10, 5]; // % levels that fire a "battery low" message while there is no grid
const GRID_CONFIRM = 2; // snapshots a grid change must hold before it is reported (power flickers are common)
const LOAD_CONFIRM = 2; // same for a grid-current level change
const UNPLANNED_AFTER_S = 5 * 60; // grid absent this long while the schedule says it should be on = unplanned outage
const LOAD_CALM = 0.85; // current must fall below this share of the warn threshold before the all-clear
const OFFLINE_S = 10 * 60; // no new data for this long = station offline
const SESSION_WARN_MS = 24 * 3600 * 1000;
const CUTOFF_PCT = 5; // default shutdown level (program 29)
const CAPACITY_WH = 5120; // nominal pack energy, see public/js/regs.js
const MAX_PER_HOUR = 30;
const PAIR_TTL_MS = 10 * 60 * 1000;

let cfg = DEFAULTS();
let state = {}; // device_id -> per-device memory, see fresh()
let sessionNote = { warned: false, expired: false };
let pairing = null; // {code, expires}
let sentLog = []; // timestamps of recent messages
let queue = []; // messages that could not be delivered yet
let texts = null; // alert names from public/js/alerts-text.js, loaded lazily

// ---------- storage ----------

function configure(dir) { DATA = dir; load(); }

function load() {
  cfg = DEFAULTS();
  try { Object.assign(cfg, JSON.parse(fs.readFileSync(file('telegram.json'), 'utf8'))); } catch { /* not configured */ }
  cfg.events = { ...DEFAULTS().events, ...(cfg.events || {}) };
  try { state = JSON.parse(fs.readFileSync(file('telegram-state.json'), 'utf8')); } catch { state = {}; }
}

function saveConfig() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(file('telegram.json'), JSON.stringify(cfg), { mode: 0o600 });
  fs.chmodSync(file('telegram.json'), 0o600);
}
function saveState() {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(file('telegram-state.json'), JSON.stringify(state)); } catch { /* best effort */ }
}

const ready = () => !!(cfg.token && cfg.chatId != null);

// What the web UI may see: never the token, never the chat id.
function publicConfig() {
  return { configured: !!cfg.token, botName: cfg.botName, paired: cfg.chatId != null, chatName: cfg.chatName, enabled: cfg.enabled, lang: cfg.lang, events: cfg.events };
}

// ---------- Telegram API ----------

async function api(method, params = {}) {
  if (!cfg.token) throw new Error('no_token');
  let r;
  try {
    r = await fetch(`${API_BASE()}/bot${cfg.token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new Error('network: ' + String(e.message).split(cfg.token).join('<token>'));
  }
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) throw new Error((j && j.description) || 'telegram_http_' + r.status);
  return j.result;
}

// Telegram bot tokens look like 123456789:AA... ; anything else is rejected before it is stored or sent anywhere.
const TOKEN_RE = /^\d{5,}:[\w-]{30,}$/;

async function setToken(token) {
  token = String(token || '').trim();
  if (!TOKEN_RE.test(token)) throw new Error('bad_token_format');
  const previous = cfg.token;
  cfg.token = token;
  try {
    const me = await api('getMe');
    cfg.botName = me.username ? '@' + me.username : me.first_name || '';
  } catch (e) { cfg.token = previous; throw e; }
  if (previous !== token) { cfg.chatId = null; cfg.chatName = ''; cfg.enabled = false; }
  saveConfig();
}

// A one-time code the owner sends to the bot proves which chat is theirs (bot usernames are public).
function startPairing() {
  if (!cfg.token) throw new Error('no_token');
  pairing = { code: String(crypto.randomInt(100000, 1000000)), expires: Date.now() + PAIR_TTL_MS };
  return { code: pairing.code, expiresInS: PAIR_TTL_MS / 1000 };
}

async function completePairing() {
  if (!pairing || pairing.expires < Date.now()) { pairing = null; throw new Error('pairing_expired'); }
  const updates = await api('getUpdates', { limit: 100, timeout: 0 });
  let found = null, last = 0;
  for (const u of updates) {
    last = Math.max(last, u.update_id);
    const m = u.message;
    if (m && m.chat && m.chat.type === 'private' && String(m.text || '').trim() === pairing.code) found = m;
  }
  if (last) api('getUpdates', { offset: last + 1, limit: 1, timeout: 0 }).catch(() => {}); // acknowledge
  if (!found) return { paired: false };
  cfg.chatId = found.chat.id;
  cfg.chatName = [found.chat.first_name, found.chat.last_name].filter(Boolean).join(' ') || found.chat.username || String(found.chat.id);
  cfg.enabled = true;
  pairing = null;
  saveConfig();
  resetState();
  await rawSend(M().paired);
  return { paired: true, chatName: cfg.chatName };
}

function update(patch) {
  if (typeof patch.enabled === 'boolean') {
    if (patch.enabled && !ready()) throw new Error('not_paired');
    cfg.enabled = patch.enabled;
  }
  if (patch.lang === 'uk' || patch.lang === 'en') cfg.lang = patch.lang;
  if (patch.events && typeof patch.events === 'object') for (const k of EVENT_KEYS) if (typeof patch.events[k] === 'boolean') cfg.events[k] = patch.events[k];
  saveConfig();
}

function clear() {
  cfg = DEFAULTS(); pairing = null; queue = [];
  try { fs.unlinkSync(file('telegram.json')); } catch { /* already gone */ }
}

// ---------- sending ----------

async function rawSend(text) {
  return api('sendMessage', { chat_id: cfg.chatId, text, disable_web_page_preview: true });
}

async function send(text) {
  if (!ready()) return false;
  const now = Date.now();
  sentLog = sentLog.filter((t) => now - t < 3600 * 1000);
  if (sentLog.length >= MAX_PER_HOUR) {
    if (sentLog.length === MAX_PER_HOUR) { sentLog.push(now); text = M().flood; } else return false;
  }
  sentLog.push(now);
  try { await rawSend(text); return true; } catch (e) {
    queue.push({ text, at: now });
    if (queue.length > 50) queue.shift();
    console.error('telegram: send failed, queued:', e.message);
    return false;
  }
}

async function flushQueue() {
  if (!queue.length || !ready()) return;
  const keep = [];
  for (const q of queue) {
    if (Date.now() - q.at > 3600 * 1000) continue; // stale news is worse than none
    try { await rawSend(q.text); } catch { keep.push(q); break; }
  }
  queue = keep;
}

// ---------- messages ----------

// One sentence about what the outage schedule says, appended to the "grid lost" message.
function schedNote(sch) {
  if (!sch || !sch.state) return '';
  const uk = cfg.lang === 'uk';
  const q = sch.queue;
  if (sch.emergency) return uk ? ' Діє графік аварійних відключень (ГАВ).' : ' An emergency outage schedule (ГАВ) is in force.';
  if (sch.state === 'off') return uk ? ` За графіком черги ${q}: відключення${sch.until ? ' до ' + sch.until : ''}.` : ` Schedule of queue ${q}: outage${sch.until ? ' until ' + sch.until : ''}.`;
  if (sch.state === 'switch') return uk ? ` За графіком черги ${q}: час перемикань, світла може не бути.` : ` Schedule of queue ${q}: switching time, power may be absent.`;
  return uk ? ` ⚠️ За графіком черги ${q} світло мало бути. Чекаю ${UNPLANNED_AFTER_S / 60} хв, чи повернеться.` : ` ⚠️ The schedule of queue ${q} says power should be on. Waiting ${UNPLANNED_AFTER_S / 60} min to see if it returns.`;
}

const MSG = {
  uk: {
    paired: '✅ Telegram підключено. Сюди приходитимуть сповіщення про станцію HATCAT: аварії, зникнення світла, низький заряд.',
    test: '🔔 Тестове повідомлення. Усе працює.',
    flood: '⚠️ Забагато подій за годину, частину повідомлень пропущено.',
    fault: (d, x) => `🔴 ${d}: помилка. ${x}`,
    warning: (d, x) => `⚠️ ${d}: попередження. ${x}`,
    cleared: (d, x, dur) => `✅ ${d}: усунено. ${x}${dur ? ` (тривало ${dur})` : ''}`,
    gridLost: (d, s, sch) => `🔌 ${d}: світло зникло. Станція живиться від батареї. Заряд ${s.soc} %, навантаження ${s.load} Вт${s.runtime ? `, вистачить приблизно на ${s.runtime}` : ''}.${schedNote(sch)}`,
    gridBack: (d, s, dur, unplanned) => `💡 ${d}: світло з'явилось (${s.gridV} В). ${dur ? `Не було ${dur}. ` : ''}${unplanned ? 'Це було позапланове відключення. ' : ''}Заряд ${s.soc} %${s.charging ? `, батарея заряджається ${s.charging} Вт` : ''}.`,
    unplanned: (d, sch, s) => `⚠️ ${d}: світла немає, хоча за графіком черги ${sch.queue} воно мало бути${sch.since ? ` (з ${sch.since}${sch.until ? ` до ${sch.until}` : ''})` : ''}. Імовірно позапланове або аварійне відключення. Заряд ${s.soc} %${s.runtime ? `, вистачить приблизно на ${s.runtime}` : ''}.`,
    gridLoad: (d, lvl, s) => `${lvl === 2 ? '🔴 Ризик вибивання ввідного автомата' : '⚠️ Підвищене споживання з мережі'}: ${d}, ≈ ${s.amps} А з ${s.breaker} А ввідного автомата (${s.kw} кВт). Навантаження ${s.va} ВА${s.charge ? ` + заряд батареї ${s.charge} Вт` : ''}.${s.charge ? (s.rec === 0 ? ' Вимкніть заряд від мережі (програма 11) або потужні прилади.' : s.rec ? ` Зменште струм заряду до ≈ ${s.rec} А (програма 11) або вимкніть потужні прилади.` : ' Зменште струм заряду від мережі (програма 11) або вимкніть потужні прилади.') : ' Вимкніть потужні прилади.'}`,
    outLoad: (d, lvl, s) => `${lvl === 2 ? '🔴 Ризик перевантаження станції' : '⚠️ Велике навантаження станції'}: ${d}, ${s.va} ВА з ${s.limit} ВА номіналу${s.battery ? ' (живиться від батареї)' : ''}. ${lvl === 2 ? 'Понад номінал станція вимкне вихід. ' : ''}Вимкніть потужні прилади.`,
    outLoadOk: (d, s) => `✅ ${d}: навантаження станції знову в нормі, ${s.va} ВА з ${s.limit} ВА.`,
    gridLoadOk: (d, s) => `✅ ${d}: споживання з мережі знову в нормі, ≈ ${s.amps} А з ${s.breaker} А.`,
    battery: (d, s) => `🪫 ${d}: заряд батареї ${s.soc} %. Навантаження ${s.load} Вт${s.runtime ? `, вистачить приблизно на ${s.runtime}` : ''}.`,
    offline: (d, at) => `📡 ${d}: станція не виходить на зв'язок. Останні дані о ${at}.`,
    online: (d) => `📶 ${d}: зв'язок відновлено.`,
    sessionSoon: (at) => `⏳ Сесія на сайті спливає ${at}. Відкрийте сайт і увійдіть знову, інакше сповіщення припиняться.`,
    sessionDone: '⛔ Сесія на сайті завершилась, сповіщення не приходитимуть. Відкрийте сайт і увійдіть знову.',
    h: 'год', m: 'хв',
  },
  en: {
    paired: '✅ Telegram connected. You will get HATCAT station alerts here: faults, power cuts, low battery.',
    test: '🔔 Test message. Everything works.',
    flood: '⚠️ Too many events in an hour, some messages were skipped.',
    fault: (d, x) => `🔴 ${d}: fault. ${x}`,
    warning: (d, x) => `⚠️ ${d}: warning. ${x}`,
    cleared: (d, x, dur) => `✅ ${d}: cleared. ${x}${dur ? ` (lasted ${dur})` : ''}`,
    gridLost: (d, s, sch) => `🔌 ${d}: grid power lost. Running on the battery. Charge ${s.soc} %, load ${s.load} W${s.runtime ? `, lasts about ${s.runtime}` : ''}.${schedNote(sch)}`,
    gridBack: (d, s, dur, unplanned) => `💡 ${d}: grid power is back (${s.gridV} V). ${dur ? `It was out for ${dur}. ` : ''}${unplanned ? 'It was an unplanned outage. ' : ''}Charge ${s.soc} %${s.charging ? `, battery charging at ${s.charging} W` : ''}.`,
    unplanned: (d, sch, s) => `⚠️ ${d}: no grid power although the schedule of queue ${sch.queue} says it should be on${sch.since ? ` (from ${sch.since}${sch.until ? ` to ${sch.until}` : ''})` : ''}. Likely an unplanned or emergency outage. Charge ${s.soc} %${s.runtime ? `, lasts about ${s.runtime}` : ''}.`,
    gridLoad: (d, lvl, s) => `${lvl === 2 ? '🔴 Main breaker trip risk' : '⚠️ High grid consumption'}: ${d}, ≈ ${s.amps} A of the ${s.breaker} A main breaker (${s.kw} kW). Load ${s.va} VA${s.charge ? ` + battery charge ${s.charge} W` : ''}.${s.charge ? (s.rec === 0 ? ' Turn off grid charging (program 11) or heavy appliances.' : s.rec ? ` Lower the grid charge current to about ${s.rec} A (program 11) or switch off heavy appliances.` : ' Lower the grid charge current (program 11) or switch off heavy appliances.') : ' Switch off heavy appliances.'}`,
    outLoad: (d, lvl, s) => `${lvl === 2 ? '🔴 Station overload risk' : '⚠️ High station load'}: ${d}, ${s.va} VA of the ${s.limit} VA rating${s.battery ? ' (running on the battery)' : ''}. ${lvl === 2 ? 'Above the rating the station shuts the output off. ' : ''}Switch off heavy appliances.`,
    outLoadOk: (d, s) => `✅ ${d}: station load is back to normal, ${s.va} VA of ${s.limit} VA.`,
    gridLoadOk: (d, s) => `✅ ${d}: grid consumption is back to normal, ≈ ${s.amps} A of ${s.breaker} A.`,
    battery: (d, s) => `🪫 ${d}: battery at ${s.soc} %. Load ${s.load} W${s.runtime ? `, lasts about ${s.runtime}` : ''}.`,
    offline: (d, at) => `📡 ${d}: the station is not reporting. Last data at ${at}.`,
    online: (d) => `📶 ${d}: connection restored.`,
    sessionSoon: (at) => `⏳ The website session expires ${at}. Open the site and sign in again or alerts will stop.`,
    sessionDone: '⛔ The website session has ended, alerts will not arrive. Open the site and sign in again.',
    h: 'h', m: 'min',
  },
};
const M = () => MSG[cfg.lang] || MSG.uk;

async function loadTexts() {
  if (texts) return texts;
  try { texts = await import(pathToFileURL(path.join(__dirname, 'public', 'js', 'alerts-text.js')).href); } catch (e) { console.error('telegram: cannot load alert texts:', e.message); texts = { FAULTS: [], WARNINGS: [], ALERT_TEXT: { uk: {}, en: {} } }; }
  return texts;
}

function alertName(id) {
  const [level, bit] = id.split(':');
  if (bit === 'mode') return (texts.ALERT_TEXT[cfg.lang] || {}).faultBadge || 'Fault';
  const names = level === 'fault' ? texts.FAULTS : texts.WARNINGS;
  const name = names[Number(bit)];
  const dict = texts.ALERT_TEXT[cfg.lang] || texts.ALERT_TEXT.uk;
  return name ? dict[level + name] || name : dict.unknownError || 'Unknown error';
}

function hm(seconds) {
  const m = M();
  const total = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(total / 60), mm = total % 60;
  return h ? `${h} ${m.h} ${mm} ${m.m}` : `${mm} ${m.m}`;
}
const clock = (sec) => new Date(sec * 1000).toLocaleTimeString(cfg.lang === 'uk' ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

// ---------- state tracking ----------

const fresh = () => ({ init: false, alerts: [], alertSince: {}, grid: null, gridSince: null, pending: null, gl: 0, glPending: null, ol: 0, olPending: null, unplanned: false, low: [], offline: false, lastT: 0 });

function resetState() { state = {}; saveState(); }

const gridPresent = (s) => (s.K2 || 0) / 10 > 100;
function alertIds(s) {
  const out = [];
  for (const [level, reg] of [['fault', 'K15'], ['warning', 'K16']]) {
    const v = Number(s[reg]) || 0;
    for (let i = 0; i < 16; i++) if (v & (1 << i)) out.push(`${level}:${i}`);
  }
  if (s.K1 === 6 && !out.some((a) => a.startsWith('fault'))) out.push('fault:mode');
  return out;
}
function stats(s) {
  const volts = (s.K6 || 0) / 10;
  const discharge = volts * (s.K9 || 0), charge = volts * (s.K8 || 0);
  const runtimeH = discharge > 20 ? Math.max(0, ((s.K7 || 0) - CUTOFF_PCT) / 100 * CAPACITY_WH / discharge) : 0;
  return { soc: s.K7, load: s.K13 || 0, gridV: ((s.K2 || 0) / 10).toFixed(0), charging: charge > 20 ? Math.round(charge) : 0, runtime: runtimeH > 0 ? hm(runtimeH * 3600) : '' };
}
function loadStats(s, amps) {
  const lim = limits.get();
  const chargeW = Math.round(((s.K6 || 0) / 10) * (s.K8 || 0));
  return { amps: amps.toFixed(1), breaker: lim.breakerA, kw: ((((s.K2 || 0) / 10) * amps) / 1000).toFixed(1), va: limits.outputVA(s), charge: chargeW > 20 ? chargeW : 0, rec: limits.recommendedChargeA(s, lim), limit: lim.inverterW, battery: s.K1 === 3 };
}
const deviceLabel = (id, info) => (info && info.name) || (info && info.mac_address ? `HATCAT ${String(info.mac_address).slice(-4)}` : `HATCAT ${id}`);

// Tracks one load level (st[field]); returns the new level once a change held for LOAD_CONFIRM snapshots, else null.
function levelChange(st, field, want, calm, first) {
  const pend = field + 'Pending';
  if (first) { st[field] = want; st[pend] = null; return null; }
  const cur = st[field] || 0;
  const candidate = want > cur ? want : cur > 0 && calm ? 0 : cur;
  if (candidate === cur) { st[pend] = null; return null; }
  st[pend] = st[pend] && st[pend].v === candidate ? { v: candidate, n: st[pend].n + 1 } : { v: candidate, n: 1 };
  if (st[pend].n < LOAD_CONFIRM) return null;
  st[field] = candidate; st[pend] = null;
  return candidate;
}

// Called for every NEW snapshot (history.js deduplicates by Time). Always tracks state; sends only when enabled.
async function snapshot(id, s, info) {
  await loadTexts();
  id = String(id);
  const st = state[id] || (state[id] = fresh());
  const label = deviceLabel(id, info);
  const out = []; // [eventKey, text]
  const first = !st.init;

  // alerts
  const now = alertIds(s), was = new Set(st.alerts);
  if (!first) {
    for (const a of now) if (!was.has(a)) out.push([a.startsWith('fault') ? 'faults' : 'warnings', M()[a.startsWith('fault') ? 'fault' : 'warning'](label, alertName(a))]);
    for (const a of st.alerts) if (!now.includes(a)) out.push(['cleared', M().cleared(label, alertName(a), st.alertSince[a] ? hm(s.t - st.alertSince[a]) : '')]);
  }
  for (const a of now) if (!st.alertSince[a]) st.alertSince[a] = s.t;
  for (const a of Object.keys(st.alertSince)) if (!now.includes(a)) delete st.alertSince[a];
  st.alerts = now;

  // grid: a change must hold for GRID_CONFIRM snapshots
  const g = gridPresent(s);
  if (st.grid === null) { st.grid = g; st.gridSince = s.t; }
  else if (g !== st.grid) {
    st.pending = st.pending && st.pending.v === g ? { v: g, n: st.pending.n + 1 } : { v: g, n: 1 };
    if (st.pending.n >= GRID_CONFIRM) {
      const lostFor = st.gridSince && !st.grid ? s.t - st.gridSince : 0;
      st.grid = g; st.pending = null;
      if (!first) out.push(['grid', g ? M().gridBack(label, stats(s), lostFor ? hm(lostFor) : '', st.unplanned) : M().gridLost(label, stats(s), outages.describe(s.t))]);
      if (g) st.unplanned = false;
      st.gridSince = s.t; st.low = [];
    }
  } else st.pending = null;

  // unplanned outage: the grid is absent but the schedule has said "on" for the last few minutes (and no emergency schedule)
  if (!first && !st.grid && !st.unplanned && st.gridSince && s.t - st.gridSince >= UNPLANNED_AFTER_S) {
    const nowSch = outages.describe(s.t), before = outages.describe(s.t - UNPLANNED_AFTER_S);
    if (nowSch.state === 'on' && before.state === 'on' && !nowSch.emergency) { st.unplanned = true; out.push(['outage', M().unplanned(label, nowSch, stats(s))]); }
  }

  // grid current against the main breaker and station output against the inverter rating:
  // a level change must hold for LOAD_CONFIRM snapshots, and the all-clear waits for a hysteresis band
  const amps = limits.gridAmps(s), lim = limits.get();
  const gridLvl = levelChange(st, 'gl', limits.level(amps, lim), amps < (lim.breakerA * lim.warnPct * LOAD_CALM) / 100, first);
  if (gridLvl !== null) out.push(['gridLoad', gridLvl > 0 ? M().gridLoad(label, gridLvl, loadStats(s, amps)) : M().gridLoadOk(label, loadStats(s, amps))]);
  const va = limits.outputVA(s);
  const outLvl = levelChange(st, 'ol', limits.outputLevel(s, lim), va < (lim.inverterW * lim.warnPct * LOAD_CALM) / 100, first);
  if (outLvl !== null) out.push(['outputLoad', outLvl > 0 ? M().outLoad(label, outLvl, loadStats(s, amps)) : M().outLoadOk(label, loadStats(s, amps))]);

  // battery low, only while the grid is absent and the pack is discharging
  if (!st.grid && (s.K9 || 0) > 0) {
    for (const step of BATTERY_STEPS) {
      if (s.K7 <= step && !st.low.includes(step)) {
        st.low.push(step);
        if (!first) out.push(['battery', M().battery(label, stats(s))]);
        break; // one message per snapshot; lower levels fire on later snapshots
      }
    }
  }
  st.low = st.low.filter((step) => s.K7 <= step + 10);

  // connection restored
  if (st.offline && !first) out.push(['offline', M().online(label)]);
  st.offline = false;
  st.lastT = s.t;
  st.init = true;
  saveState();

  if (cfg.enabled && ready()) for (const [key, text] of out) if (cfg.events[key]) await send(text);
}

// Called once a minute by the poller (also while the session is dead): offline detection, session expiry, retry queue.
async function tick(info) {
  await loadTexts();
  if (cfg.enabled && ready()) {
    await flushQueue();
    const nowS = Math.floor(Date.now() / 1000);
    for (const [id, st] of Object.entries(state)) {
      if (st.init && !st.offline && st.lastT && nowS - st.lastT > OFFLINE_S && info && info.active) {
        st.offline = true; saveState();
        if (cfg.events.offline) await send(M().offline(deviceLabel(id, null), clock(st.lastT)));
      }
    }
    if (info && info.tokenExpires) {
      const left = info.tokenExpires - Date.now();
      if (left <= 0 && !sessionNote.expired) {
        sessionNote.expired = true; sessionNote.warned = true;
        if (cfg.events.session) await send(M().sessionDone);
      } else if (left > 0 && left < SESSION_WARN_MS && !sessionNote.warned) {
        sessionNote.warned = true;
        if (cfg.events.session) await send(M().sessionSoon(new Date(info.tokenExpires).toLocaleString(cfg.lang === 'uk' ? 'uk-UA' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })));
      } else if (left > SESSION_WARN_MS) { sessionNote = { warned: false, expired: false }; } // a new login resets it
    }
  }
}

async function sendTest() {
  if (!ready()) throw new Error('not_paired');
  await rawSend(M().test);
}

// ---------- HTTP ----------

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// GET /telegram/status; POST /telegram/{token,pair,discover,config,test,clear}. Caller has already checked the session.
async function handle(req, res, readBody) {
  const route = new URL(req.url, 'http://x').pathname.replace(/^\/telegram\/?/, '');
  try {
    if (req.method === 'GET' && route === 'status') return json(res, 200, publicConfig());
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { error: 'bad_json' }); }
    if (route === 'token') { await setToken(body.token); return json(res, 200, publicConfig()); }
    if (route === 'pair') return json(res, 200, startPairing());
    if (route === 'discover') return json(res, 200, { ...(await completePairing()), ...publicConfig() });
    if (route === 'config') { update(body); return json(res, 200, publicConfig()); }
    if (route === 'test') { await sendTest(); return json(res, 200, { ok: true }); }
    if (route === 'clear') { clear(); return json(res, 200, publicConfig()); }
    return json(res, 404, { error: 'not_found' });
  } catch (e) {
    return json(res, 400, { error: String(e.message).split(cfg.token || '\0').join('<token>') });
  }
}

module.exports = { configure, handle, snapshot, tick, publicConfig, _test: { alertIds, gridPresent, stats, setToken, startPairing, completePairing, update, clear, send, state: () => state, cfg: () => cfg, resetLimiter: () => { sentLog = []; } } };
