import { h, icon, mount } from '../dom.js';
import { t } from '../i18n.js';
import { unit, power, num, time, elapsed, duration, clock } from '../fmt.js';
import { telemetry, deviceRow, SURE, NOMINAL_CAPACITY_WH, runtimeHours, pvStatus, activeSources, flowState, levelOf, outputLoadVA, recommendedChargeA, PV_MIN_V, PV_MAX_V } from '../regs.js';
import { todayFor, stat } from '../today.js';
import { activeAlerts } from '../alerts.js';
import { getLimits } from '../limits.js';
import { settingsFor, reg } from '../settings.js';
import { REG_CYCLES, REG_CUTOFF } from '../programs.js';
import { deviceHead } from './device-head.js';

let rawOpen = false; // keep the raw block expanded across 30 s re-renders

// One value row; "?" marks registers whose meaning is not confirmed yet.
function row(label, key, m, u, digits = 0) {
  const v = m[key];
  if (v == null) return null;
  return [
    h('dt', {}, label, !SURE.has(key) && h('abbr', { class: 'unsure', title: t('unconfirmed') }, '?')),
    h('dd', {}, typeof v === 'number' ? unit(v, u, digits) : String(v)),
  ];
}

function section(title, iconName, accent, rows) {
  const body = rows.filter(Boolean);
  if (!body.length) return null;
  return h('section', { class: 'card metric', style: { '--accent-c': `var(${accent})` } },
    h('h3', {}, icon(iconName), title),
    h('dl', { class: 'kv' }, body),
  );
}

function badge(cls, iconName, label, value, sub, active) {
  return h('div', { class: `flow-badge ${cls}` + (active ? ' active' : '') },
    h('span', { class: 'flow-icon' }, icon(iconName)),
    h('span', { class: 'flow-text' },
      h('span', { class: 'flow-label' }, label),
      h('span', { class: 'flow-value' }, value),
      sub && h('span', { class: 'flow-sub' }, sub),
    ),
  );
}

// Cable routes in the hero stage's 1700 x 1400 coordinates; day and night pictures line up, so one set serves both.
const WIRES = {
  pv: 'M588 655 L592 700 Q592 730 580 745 L578 905', // roof conduit down to the station
  grid: 'M248 1055 L248 1235 Q250 1285 310 1287 L538 1243', // meter box along the base board
  home: 'M820 1095 L1205 1013', // station to the window
  battery: 'M800 1010 L800 1250', // down the station front: charging flows down, discharging up
};
const SVG_NS = 'http://www.w3.org/2000/svg';

// Animated dashes run along each active cable; speed follows the power, direction follows the flow.
function flowOverlay(m) {
  const f = flowState(m);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1700 1400');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'flow-svg');
  svg.setAttribute('aria-hidden', 'true');
  const wires = [
    ['pv', f.pv, 'pv', f.pvW, false],
    ['grid', f.grid, 'grid', f.gridW || f.loadW, false],
    ['home', f.home != null, f.home === 'battery' ? 'battery' : f.home === 'solar' ? 'pv' : 'grid', f.loadW, false],
    ['battery', f.battery !== 'idle', 'battery', f.batteryW, f.battery === 'discharging'],
  ];
  for (const [name, on, color, watts, reverse] of wires) {
    if (!on) continue;
    const dur = (2.6 - 1.9 * Math.min(1, watts / 3000)).toFixed(2) + 's';
    for (const cls of ['glow', 'dash']) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', WIRES[name]);
      path.setAttribute('class', `${cls} wire-${color}${cls === 'dash' && reverse ? ' rev' : ''}`);
      if (cls === 'dash') path.style.setProperty('--dur', dur);
      svg.append(path);
    }
  }
  return svg;
}

// Two plain sentences under the picture: what feeds the house, and whether the battery charges.
function flowLegend(m) {
  const f = flowState(m);
  const homeText = f.home === 'grid' ? t('fromGridBypass') : f.home === 'battery' ? t(f.homeWithSun ? 'fromSolarBattery' : 'fromBattery') : f.home === 'solar' ? t('fromSolar') : t('noLoad');
  const batteryText = f.battery === 'charging'
    ? (f.chargeFrom ? t('batteryChargingFrom', { src: t(f.chargeFrom === 'grid' ? 'chargeSrcGrid' : 'chargeSrcSolar') }) : t('batteryCharging')) + ' · ' + power(f.batteryW)
    : f.battery === 'discharging' ? t('batteryDischarging') + ' · ' + power(f.batteryW) : t('batteryNotCharging');
  return h('div', { class: 'flow-legend' },
    h('div', { class: 'flow-line', 'data-src': f.home || 'none' }, h('i', { class: 'flow-dot ' + (f.home === 'battery' ? 'battery' : f.home === 'solar' ? 'pv' : 'grid') }), h('span', {}, t('homePoweredBy') + ' '), h('b', {}, homeText),
      f.home && h('span', { class: 'muted' }, ' · ' + power(f.loadW))),
    h('div', { class: 'flow-line', 'data-battery': f.battery }, h('i', { class: 'flow-dot battery' + (f.battery === 'idle' ? ' off' : '') }), h('b', {}, batteryText)),
  );
}

function hero(m) {
  const batState = m.batteryPower > 20 ? 'charging' : m.batteryPower < -20 ? 'discharging' : 'idle';
  const gridValue = m.gridPresent ? power(m.gridPower) : t('gridAbsent');
  return h('div', { class: 'card hero' },
    h('div', { class: 'hero-stage' },
      h('img', { class: 'hero-img day', src: 'assets/img/ess_home.webp', alt: '' }),
      h('img', { class: 'hero-img night', src: 'assets/img/ess_home_night.webp', alt: '' }),
      flowOverlay(m),
      badge('b-pv', 'solar_battery', t('solar'), power(m.pvPower), m.pvVoltage ? unit(m.pvVoltage, 'V', 1) : null, m.pvPower > 5),
      badge('b-grid', 'grid_from', t('grid'), gridValue, m.gridPresent ? unit(m.gridVoltage, 'V', 1) : null, m.gridPresent && m.gridPower > 5),
      badge('b-home', 'home', t('home'), power(m.loadPower), m.loadPercent != null ? num(m.loadPercent) + ' %' : null, m.loadPower > 5),
      badge('b-bat', 'battery', t('battery'), m.batteryPower != null ? power(Math.abs(m.batteryPower)) : '–', t(batState), batState !== 'idle'),
    ),
    flowLegend(m),
  );
}

function socCard(m, cutoff) {
  const soc = Math.max(0, Math.min(100, m.soc ?? 0));
  const r = 52, c = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'soc-ring');
  svg.innerHTML = `<circle cx="60" cy="60" r="${r}" class="ring-bg"/>` +
    `<circle cx="60" cy="60" r="${r}" class="ring-fg${soc < 20 ? ' low' : ''}" stroke-dasharray="${(c * soc) / 100} ${c}" transform="rotate(-90 60 60)"/>`;
  const batState = m.batteryPower > 20 ? 'charging' : m.batteryPower < -20 ? 'discharging' : 'idle';
  const runtime = runtimeHours(m, cutoff);
  return h('div', { class: 'card soc-card' },
    h('div', { class: 'soc-wrap' }, svg,
      h('div', { class: 'soc-num' }, m.soc != null ? Math.round(m.soc) : '–', h('small', {}, '%')),
    ),
    h('div', { class: 'soc-meta' },
      h('div', { class: 'soc-state ' + batState }, t(batState)),
      runtime && h('div', { class: 'soc-runtime' }, t(m.batteryPower < 0 ? 'runtimeLeft' : 'runtimeFull', { t: duration(runtime) })),
      h('dl', { class: 'kv' },
        row(t('voltage'), 'batteryVoltage', m, 'V', 1),
        m.batteryPower != null && [h('dt', {}, t('power')), h('dd', {}, power(Math.abs(m.batteryPower)))],
      ),
    ),
  );
}

// "228,0 V · 15:50": a value with the time it was recorded.
function atTime(label, point, u, digits = 0, floor = 0) {
  if (!point || !(point.v > floor)) return null; // below the floor it is residual noise, not a real reading
  return [h('dt', {}, label), h('dd', {}, `${unit(point.v, u, digits)} · ${clock(point.t * 1000)}`)];
}

// While load plus charge crowd the main breaker: the charge current (program 11) that would keep it quiet.
function chargeAdvice(m) {
  const lim = getLimits();
  if (!(m.gridAmps >= (lim.breakerA * lim.warnPct) / 100) || !(m.chargeCurrent > 0)) return null;
  const rec = recommendedChargeA(m, lim);
  if (rec == null) return null;
  return [h('dt', {}, t('recChargeA')), h('dd', {}, rec === 0 ? t('recChargeOff') : `≤ ${rec} A`)];
}

// A value against its limit (main breaker amps or inverter VA), with the warn and alarm marks.
function limitGauge(value, max, label) {
  const lim = getLimits();
  const pct = Math.min(100, (value / max) * 100);
  return h('div', { class: 'limit-gauge level-' + levelOf(value, max, lim), role: 'img', 'aria-label': label },
    h('i', { style: { width: pct + '%' } }),
    h('b', { class: 'mark', style: { left: lim.warnPct + '%' } }), h('b', { class: 'mark', style: { left: lim.alarmPct + '%' } }));
}

// PV input voltage on the app's 60-450 V gauge.
function voltageGauge(v) {
  const pct = Math.max(0, Math.min(100, ((v - PV_MIN_V) / (PV_MAX_V - PV_MIN_V)) * 100));
  return h('div', { class: 'gauge', role: 'img', 'aria-label': `${num(v, 1)} V` },
    h('i', { style: { width: pct + '%' } }),
    h('span', { class: 'gauge-min' }, PV_MIN_V + ' V'), h('span', { class: 'gauge-max' }, PV_MAX_V + ' V'));
}

function sourceIcons(m) {
  const on = activeSources(m);
  return h('span', { class: 'sources' }, [['solar', 'solar_battery', 'solar'], ['battery', 'battery', 'battery'], ['grid', 'grid_from', 'grid']].map(([k, ic, label]) =>
    h('span', { class: 'source' + (on[k] ? ' on ' + k : ''), title: t(label) + (on[k] ? '' : ' (–)') }, icon(ic))));
}

export function stationView(root, { data, deviceId, rerender }) {
  const d = (data.json?.devices || []).find((x) => String(x.device_id) === String(deviceId));
  if (!d) { location.hash = '#/devices'; return; }
  const found = deviceRow(data.json, deviceId);
  const head = deviceHead(d, '');
  if (!found || found.list !== 'mas_powerstation') {
    // Battery modules and devices without telemetry: show whatever the server sent.
    root.replaceChildren(...head, h('div', { class: 'card pad' }, h('p', { class: 'muted' }, t('noData')),
      found && h('pre', { class: 'raw' }, JSON.stringify(found.row, null, 2))));
    return;
  }
  const m = telemetry(found.row);
  const alerts = activeAlerts(m);
  const { regs } = settingsFor(deviceId, rerender);
  const today = todayFor(deviceId, d.deviceTimeZone, rerender);
  const gridV = stat(today, 'K2'), gridHz = stat(today, 'K3'), load = stat(today, 'K13'), pv = stat(today, 'K5'), socDay = stat(today, 'K7');
  const cutoff = reg(regs, REG_CUTOFF);
  const cycles = reg(regs, REG_CYCLES);
  const statusLine = h('div', { class: 'status-line' },
    h('span', { class: 'dot' + (m.online ? ' ok' : ' bad') }),
    m.online ? t('online') : t('offlineFor', { t: elapsed(m.time) }),
    h('span', { class: 'sep' }, '·'),
    m.time ? t('updated', { t: time(m.time) }) : t('noData'),
    m.mode && h('span', { class: 'chip' + (m.fault ? ' bad' : '') }, m.mode),
  );

  const raw = h('details', { class: 'card raw-block', ontoggle: (e) => { rawOpen = e.target.open; } },
    h('summary', {}, t('rawData')),
    h('table', { class: 'raw-table' },
      h('tbody', {}, m.raw.map(({ reg, def, rawVal, v }) => h('tr', {},
        h('td', { class: 'mono' }, reg),
        h('td', {}, def.key, !def.sure && h('abbr', { class: 'unsure', title: t('unconfirmed') }, '?')),
        h('td', { class: 'mono num' }, rawVal),
        h('td', { class: 'mono num' }, def.unit ? unit(Number(v), def.unit, def.scale ? 1 : 0) : ''),
      ))),
    ),
    h('pre', { class: 'raw mono' }, JSON.stringify(found.row, null, 2)),
  );
  raw.open = rawOpen;

  mount(root,
    ...head,
    statusLine,
    alertBanner(alerts),
    h('div', { class: 'overview' }, hero(m), socCard(m, cutoff)),
    h('div', { class: 'metrics' },
      section(t('pvParams'), 'solar_battery', '--c-pv', [
        pvStatus(m) && [h('dt', {}, t('status'), h('abbr', { class: 'unsure', title: t('unconfirmed') }, '?')), h('dd', { class: 'wrap-text' }, t('pv_' + pvStatus(m)))],
        row(t('power'), 'pvPower', m, 'W'), row(t('voltage'), 'pvVoltage', m, 'V', 1), row(t('current'), 'pvCurrent', m, 'A', 1),
        m.pvVoltage != null && [h('dt', { class: 'full' }, voltageGauge(m.pvVoltage))],
        pv && pv.max.v > 0 && atTime(t('maxToday'), pv.max, 'W'),
      ]),
      section(t('inputGrid'), 'grid_from', '--c-grid', [
        [h('dt', {}, t('status')), h('dd', {}, m.gridPresent ? t('gridAvailable') : t('gridAbsent'))],
        row(t('voltage'), 'gridVoltage', m, 'V', 1), row(t('frequency'), 'gridFreq', m, 'Hz', 1), row(t('power'), 'gridPower', m, 'W'),
        m.gridAmps > 0 && [h('dt', {}, t('gridAmps'), h('abbr', { class: 'unsure', title: t('unconfirmed') }, '?')), h('dd', {}, `${num(m.gridAmps, 1)} / ${getLimits().breakerA} A`)],
        m.gridAmps > 0 && [h('dt', { class: 'full' }, limitGauge(m.gridAmps, getLimits().breakerA, `${num(m.gridAmps, 1)} / ${getLimits().breakerA} A`))],
        chargeAdvice(m),
        gridV && atTime(t('maxVoltageToday'), gridV.max, 'V', 1, 100),
        gridHz && atTime(t('maxFreqToday'), gridHz.max, 'Hz', 1, 40),
      ]),
      section(t('batteryParams'), 'battery', '--c-bat', [
        row(t('soc'), 'soc', m, '%'), row(t('voltage'), 'batteryVoltage', m, 'V', 1),
        row(t('chargeCurrent'), 'chargeCurrent', m, 'A'), row(t('dischargeCurrent'), 'dischargeCurrent', m, 'A'),
        [h('dt', {}, t('capacity')), h('dd', {}, unit(NOMINAL_CAPACITY_WH, 'Wh'))],
        cutoff != null && [h('dt', {}, t('cutoffLevel'), h('abbr', { class: 'unsure', title: t('unconfirmed') }, '?')), h('dd', {}, `${num(cutoff)} %`)],
        cycles != null && [h('dt', {}, t('cycles')), h('dd', {}, num(cycles))],
        socDay && [h('dt', {}, t('socToday')), h('dd', {}, `${num(socDay.min.v)}–${num(socDay.max.v)} %`)],
      ]),
      section(t('loadParams'), 'socket', '--c-load', [
        row(t('power'), 'loadPower', m, 'W'), row(t('apparentPower'), 'outVA', m, 'VA'), row(t('loadLevel'), 'loadPercent', m, '%'),
        outputLoadVA(m) > 0 && [h('dt', {}, t('inverterLimit')), h('dd', {}, `${num(outputLoadVA(m))} / ${getLimits().inverterW} VA`)],
        outputLoadVA(m) > 0 && [h('dt', { class: 'full' }, limitGauge(outputLoadVA(m), getLimits().inverterW, `${num(outputLoadVA(m))} / ${getLimits().inverterW} VA`))],
        load && load.avg != null && [h('dt', {}, t('avgToday')), h('dd', {}, power(load.avg))],
        load && atTime(t('maxLoadToday'), load.max, 'W'),
      ]),
      section(t('inverterParams'), 'work_state', '--c-inv', [
        [h('dt', {}, t('workMode')), h('dd', {}, m.mode || '–')],
        [h('dt', {}, t('activeSources')), h('dd', {}, sourceIcons(m))],
        row(t('voltage'), 'outVoltage', m, 'V', 1), row(t('frequency'), 'outFreq', m, 'Hz', 1),
      ]),
      section(t('temperature'), 'temperature', '--c-temp', [
        pair(t('cells'), m.cells, ['tempCells1', 'tempCells2']),
        pair(t('bms'), m.bms, ['tempBms1', 'tempBms2']),
        pair(t('inverter'), m.inverter, ['tempInv1', 'tempInv2']),
      ]),
    ),
    todayNote(today),
    raw,
  );
}

// The server only knows what it recorded, so say so when the day is not covered from midnight.
function todayNote(today) {
  if (!today?.first) return null;
  const start = new Date(today.first * 1000);
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  if (start - midnight < 30 * 60 * 1000) return null;
  return h('p', { class: 'muted small today-note' }, t('todaySince', { t: clock(start.getTime()) }));
}

// Active faults and warnings, worded as in the phone app.
function alertBanner(alerts) {
  if (!alerts.length) return null;
  return h('div', { class: 'alerts', role: 'alert' }, alerts.map((a) => h('div', { class: 'alert ' + a.level + (a.high ? ' high' : '') },
    h('strong', {}, t(a.level === 'fault' ? 'faultBadge' : 'warningBadge')), h('span', {}, a.text))));
}

// Two sensors in one row, sorted: "22.7 / 23.5 °C" (min / max).
function pair(label, range, keys) {
  if (!range) return null;
  const sure = keys.every((k) => SURE.has(k));
  return [
    h('dt', {}, label, !sure && h('abbr', { class: 'unsure', title: t('unconfirmed') }, '?')),
    h('dd', {}, `${num(range.min, 1)} / ${num(range.max, 1)} °C`),
  ];
}
