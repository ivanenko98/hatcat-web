// HATCAT register maps. Confidence levels follow docs/API.md:
// sure:true is confirmed against a live response; everything else is a best guess shown with "?".
import { t } from './i18n.js';

export const DEV_TYPE = { STATION: '1' };
export const ONLINE_MS = 5 * 60 * 1000;

// mas_powerstation K1..K36
export const KMAP = {
  K1: { key: 'modeCode', sure: true },
  // K2/K3 were zero on battery power; once the grid came back (22:01) they read 215-220 and 49.9-50.0,
  // and K10/K11 (the output) follow them in Line mode, so they are the grid voltage and frequency.
  K2: { key: 'gridVoltage', unit: 'V', scale: 0.1, sure: true },
  K3: { key: 'gridFreq', unit: 'Hz', scale: 0.1, sure: true },
  K4: { key: 'pvVoltage', unit: 'V', scale: 0.1 }, // guess: sits between grid Hz and PV power, 0 in every sample so far
  // K5 flips 2 <-> 3 exactly when the app's PV input power flips 2 W <-> 3 W (20:50:37 and 20:51:05).
  K5: { key: 'pvPower', unit: 'W', sure: true },
  K6: { key: 'batteryVoltage', unit: 'V', scale: 0.1, sure: true },
  K7: { key: 'soc', unit: '%', sure: true },
  // K8 = 40 while the pack charged at 0.7 %/min = 40 A x 52.9 V on 5.12 kWh (the grid charge limit is 40 A).
  K8: { key: 'chargeCurrent', unit: 'A', sure: true },
  K9: { key: 'dischargeCurrent', unit: 'A', sure: true }, // 14 A x 51.8 V = 725 W, the app showed 727 W
  K10: { key: 'outVoltage', unit: 'V', scale: 0.1, sure: true },
  K11: { key: 'outFreq', unit: 'Hz', scale: 0.1, sure: true },
  K12: { key: 'outVA', unit: 'VA', sure: true },
  K13: { key: 'loadPower', unit: 'W', sure: true },
  K14: { key: 'loadPercent', unit: '%', sure: true },
  // The app's notification builder reads K15 into the fault-bit loop and K16 into the warning-bit loop (docs/API.md).
  // Both stayed 0 in every sample so far (no alarms), so the bit meaning is from the code, not yet seen live.
  K15: { key: 'faultMask', sure: true },
  K16: { key: 'warningMask', sure: true },
  K17: { key: 'k17' },
  K18: { key: 'k18' },
  K19: { key: 'k19' },
  K20: { key: 'k20' },
  // Checked against the phone app on 2026-10-28: cells 22.7 / 23.5 °C = K36 / K35.
  // The two sensors of a pair swap min/max over time, so they are sorted for display.
  K31: { key: 'tempBms1', unit: '°C', scale: 0.1 },
  K32: { key: 'tempBms2', unit: '°C', scale: 0.1 },
  K33: { key: 'tempInv1', unit: '°C', scale: 0.1 },
  K34: { key: 'tempInv2', unit: '°C', scale: 0.1 },
  K35: { key: 'tempCells1', unit: '°C', scale: 0.1, sure: true },
  K36: { key: 'tempCells2', unit: '°C', scale: 0.1, sure: true },
};
export const SURE = new Set(Object.values(KMAP).filter((d) => d.sure).map((d) => d.key));

// Nominal pack energy: 5120 Wh = 51.2 V x 100 Ah (phone app and the ESSM-4.2KW-100AH datasheet). The cloud does not report it.
export const NOMINAL_CAPACITY_WH = 5120;

// PV input window shown by the app (voltage gauge 60 - 450 V); below the minimum the panels count as not connected.
export const PV_MIN_V = 60;
export const PV_MAX_V = 450;

// Grid is considered present above this input voltage.
const GRID_MIN_V = 100;
const CHARGER_EFF = 0.93; // grid watts needed per watt that reaches the battery

// Index -> mode as the app's switch has it: 0 Power On, 1 Test, 2 Standby, 3 Battery, 4 Line, 5 Bypass, 6 Fault, 7 Shutdown.
// K1 = 3 (Battery) and K1 = 4 (Line) are confirmed live; code 8 is shown as Standby by the app.
export const MODE = { POWER_ON: 0, TEST: 1, STANDBY: 2, BATTERY: 3, LINE: 4, BYPASS: 5, FAULT: 6, SHUTDOWN: 7 };

export function modeName(code) {
  const list = t('modes');
  const i = code === 8 ? MODE.STANDBY : code;
  return Number.isInteger(i) && list[i] ? list[i] : t('unknownMode', { n: code });
}

// Row from mas_powerstation -> numeric metrics plus a few derived values.
export function telemetry(row) {
  const m = { raw: [] };
  for (const [k, rawVal] of Object.entries(row)) {
    if (!/^K\d+$/.test(k)) continue;
    const def = KMAP[k] || { key: k.toLowerCase() };
    const n = Number(rawVal);
    const v = Number.isFinite(n) ? +(n * (def.scale || 1)).toFixed(3) : rawVal;
    m[def.key] = v;
    m.raw.push({ reg: k, def, rawVal, v });
  }
  m.raw.sort((a, b) => Number(a.reg.slice(1)) - Number(b.reg.slice(1)));
  m.time = row.Time ? Number(row.Time) * 1000 : null;
  m.online = m.time != null && Date.now() - m.time < ONLINE_MS;
  const range = (a, b) => (a != null && b != null ? { min: Math.min(a, b), max: Math.max(a, b) } : null);
  m.cells = range(m.tempCells1, m.tempCells2);
  m.bms = range(m.tempBms1, m.tempBms2);
  m.inverter = range(m.tempInv1, m.tempInv2);
  m.mode = m.modeCode != null ? modeName(m.modeCode) : null;
  m.fault = m.modeCode === MODE.FAULT;
  m.gridPresent = m.gridVoltage != null ? m.gridVoltage > GRID_MIN_V : null;
  if (m.batteryVoltage != null) {
    const amps = (m.chargeCurrent || 0) - (m.dischargeCurrent || 0);
    m.batteryPower = Math.round(m.batteryVoltage * amps); // >0 charging
  }
  // The cloud has no grid power register. In Line/Bypass the grid carries the load plus the charge, so estimate it.
  if (m.modeCode === MODE.LINE || m.modeCode === MODE.BYPASS) m.gridPower = Math.round((m.loadPower || 0) + Math.max(0, m.batteryPower || 0));
  else if (m.gridPresent === false) m.gridPower = 0;
  m.gridAmps = gridAmps(m);
  return m;
}

export function deviceRow(json, deviceId) {
  for (const list of ['mas_powerstation', 'mas_battery_new', 'mas_battery']) {
    const rows = json?.[list];
    if (!Array.isArray(rows)) continue;
    const row = rows.find((r) => String(r.id_device ?? r.device_id) === String(deviceId));
    if (row) return { row, list };
  }
  return null;
}

export function deviceTitle(d) {
  if (d.name) return d.name;
  const base = d.dev_type === DEV_TYPE.STATION ? t('powerStation') : d.dev_type ? t('batteryModule') : t('unknownDevice');
  return d.mac_address ? `${base} ${String(d.mac_address).slice(-4)}` : base;
}

export function deviceImage(d) {
  return d.dev_type === DEV_TYPE.STATION ? 'assets/img/powerstation_small.webp' : 'assets/img/battery_small.webp';
}

// Estimated hours until the station shuts down (discharging) or the pack is full (charging).
// The app's "~2 h 36 min" at 42 % / 727 W reproduces with (soc - cutoff) x capacity / power.
export function runtimeHours(m, cutoffPct) {
  if (m.soc == null || m.batteryPower == null || Math.abs(m.batteryPower) < 20) return null;
  const wh = m.batteryPower < 0
    ? ((m.soc - (cutoffPct ?? 0)) / 100) * NOMINAL_CAPACITY_WH
    : ((100 - m.soc) / 100) * NOMINAL_CAPACITY_WH;
  return wh > 0 ? wh / Math.abs(m.batteryPower) : null;
}

// 'on' = producing (power, K5), else 'off' = panel voltage below the minimum, 'idle' = connected but not producing.
// The voltage register (K4) is unconfirmed.
export function pvStatus(m) {
  if ((m.pvPower ?? 0) > 10) return 'on';
  if (m.pvVoltage == null) return null;
  return m.pvVoltage < PV_MIN_V ? 'off' : 'idle';
}

// Which sources feed the load right now, from the mode code (K1).
export function activeSources(m) {
  return {
    solar: (m.pvPower ?? 0) > 10,
    battery: m.modeCode === MODE.BATTERY,
    grid: m.modeCode === MODE.LINE || m.modeCode === MODE.BYPASS,
  };
}

// Energy flow for the house picture. Line (4) and Bypass (5) pass the grid straight to the load, Battery (3) runs
// the load from the pack. `charging` is batteryPower > 0 (K8 charge current minus K9 discharge current, times pack volts).
export function flowState(m) {
  const line = m.modeCode === MODE.LINE || m.modeCode === MODE.BYPASS;
  const pv = (m.pvPower ?? 0) > 10;
  const loadW = m.loadPower ?? 0;
  const battery = (m.batteryPower ?? 0) > 20 ? 'charging' : (m.batteryPower ?? 0) < -20 ? 'discharging' : 'idle';
  // On inverter power the load is fed by the sun when it is producing and the pack is not discharging into the load.
  const home = loadW > 5 ? (line ? 'grid' : pv && battery !== 'discharging' ? 'solar' : m.modeCode === MODE.BATTERY ? 'battery' : pv ? 'solar' : null) : null;
  const chargeFrom = battery === 'charging' ? (line ? 'grid' : pv ? 'solar' : null) : null;
  const homeWithSun = home === 'battery' && pv; // the sun helps the pack carry the load
  return { line, pv, grid: line, home, homeWithSun, battery, chargeFrom, loadW, batteryW: Math.abs(m.batteryPower ?? 0), pvW: m.pvPower ?? 0, gridW: m.gridPower ?? 0 };
}

// Amps the grid supplies (estimate; the cloud has no such register): output apparent power plus the battery charge,
// over the grid voltage. Only Line and Bypass draw from the grid. Mirrors gridAmps() in limits.js on the server.
export function gridAmps(m) {
  if (m.gridVoltage == null || m.gridVoltage < GRID_MIN_V || (m.modeCode !== MODE.LINE && m.modeCode !== MODE.BYPASS)) return 0;
  const va = m.outVA || m.loadPower || 0;
  const chargeW = (m.batteryVoltage || 0) * (m.chargeCurrent || 0);
  return (va + chargeW / CHARGER_EFF) / m.gridVoltage;
}

// 0 = fine, 1 = high, 2 = close to the maximum, for any value against its limit. Mirrors levelOf() in limits.js.
export function levelOf(value, max, lim) {
  if (value >= (max * lim.alarmPct) / 100) return 2;
  if (value >= (max * lim.warnPct) / 100) return 1;
  return 0;
}
export const gridLoadLevel = (amps, lim) => levelOf(amps, lim.breakerA, lim);

// Apparent power the station delivers (VA), the figure the inverter rating limits.
export const outputLoadVA = (m) => m.outVA || m.loadPower || 0;

// Grid charge current (program 11) that keeps load plus charge under the breaker's warn threshold, rounded down to 5 A.
export function recommendedChargeA(m, lim) {
  if (m.gridVoltage == null || m.gridVoltage < GRID_MIN_V || !(m.batteryVoltage > 0)) return null;
  const spareVA = (lim.breakerA * m.gridVoltage * lim.warnPct) / 100 - outputLoadVA(m);
  return Math.max(0, Math.floor((spareVA * CHARGER_EFF) / m.batteryVoltage / 5) * 5);
}
