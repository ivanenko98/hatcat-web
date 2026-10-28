// Active faults and warnings from the telemetry bitmasks: K15 = faults, K16 = warnings (bit i -> table index i).
import { t } from './i18n.js';
import { FAULTS, WARNINGS } from './alerts-text.js';
import { telemetry, deviceRow, gridLoadLevel, levelOf, outputLoadVA } from './regs.js';
import { getLimits } from './limits.js';
import { num } from './fmt.js';
import { getOutages, stateAt } from './outages.js';
import { webEnabled } from './notify-prefs.js';

const LOW_CHARGE_PCT = 10; // the app also warns below 10 %

// [{level: 'fault'|'warning', id, text}] for one telemetry object (from regs.telemetry).
export function activeAlerts(m) {
  const out = [];
  const bits = (mask, names, level) => {
    const v = Number(mask) || 0;
    for (let i = 0; i < 16; i++) {
      if (!(v & (1 << i))) continue;
      out.push({ level, kind: level === 'fault' ? 'faults' : 'warnings', id: `${level}:${i}`, text: names[i] ? t(level + names[i]) : t('unknownError') });
    }
  };
  bits(m.faultMask, FAULTS, 'fault');
  bits(m.warningMask, WARNINGS, 'warning');
  if (m.soc != null && m.soc < LOW_CHARGE_PCT) out.push({ level: 'warning', kind: 'battery', id: 'warning:lowCharge', text: t('lowCharge') });
  // Grid current near the main breaker: an estimate, shown as a warning (two levels).
  const lim = getLimits();
  const level = gridLoadLevel(m.gridAmps || 0, lim);
  if (level > 0) out.push({ level: 'warning', kind: 'gridLoad', high: level === 2, id: level === 2 ? 'warning:gridLoadHigh' : 'warning:gridLoad', text: t(level === 2 ? 'gridLoadAlarm' : 'gridLoadWarn', { a: num(m.gridAmps, 1), limit: lim.breakerA }) });
  // Station output against the inverter rating (the limit on battery power).
  const va = outputLoadVA(m);
  const outLevel = levelOf(va, lim.inverterW, lim);
  if (outLevel > 0) out.push({ level: 'warning', kind: 'outputLoad', high: outLevel === 2, id: outLevel === 2 ? 'warning:outLoadHigh' : 'warning:outLoad', text: t(outLevel === 2 ? 'outLoadAlarm' : 'outLoadWarn', { va: num(va), limit: lim.inverterW }) });
  // No grid although the outage schedule has said "on" for the last 5 minutes (and no emergency schedule is in force).
  const sched = getOutages();
  if (sched && m.gridPresent === false && !(sched.emergency || []).length) {
    const nowMs = Date.now();
    if (stateAt(sched, nowMs) === 'on' && stateAt(sched, nowMs - 5 * 60 * 1000) === 'on') {
      out.push({ level: 'warning', kind: 'outage', high: true, id: 'warning:outageUnplanned', text: t('outageUnplannedAlert', { q: sched.queue }) });
    }
  }
  // Mode "Fault" with no bit set still deserves a line.
  if (m.fault && !out.some((a) => a.level === 'fault')) out.push({ level: 'fault', kind: 'faults', id: 'fault:mode', text: t('faultBadge') });
  return out.filter((a) => webEnabled(a.kind));
}

export const faultsOf = (alerts) => alerts.filter((a) => a.level === 'fault');
export const warningsOf = (alerts) => alerts.filter((a) => a.level === 'warning');

// One entry per device of an m_get_my_device response: {device, m, alerts}. Battery modules have no m yet.
export function alertsByDevice(json) {
  return (json?.devices || []).map((device) => {
    const found = deviceRow(json, device.device_id);
    const m = found && found.list === 'mas_powerstation' ? telemetry(found.row) : null;
    return { device, m, alerts: m ? activeAlerts(m) : [] };
  });
}
