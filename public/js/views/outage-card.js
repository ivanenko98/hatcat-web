// Dashboard card: planned outage schedule for today and tomorrow, what the station really saw, and mismatches.
import { h, icon } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { duration, clock } from '../fmt.js';
import { getHistory } from '../api.js';
import { outagesFor, analyse, actualCells, cellClock } from '../outages.js';

const GRID_TTL_MS = 60 * 1000;
const gridCache = new Map(); // deviceId -> {at, points, pending}

function gridPoints(deviceId, rerender) {
  let e = gridCache.get(deviceId);
  if (!e) { e = { at: 0, points: [], pending: false }; gridCache.set(deviceId, e); }
  if (!e.pending && Date.now() - e.at > GRID_TTL_MS) {
    e.pending = true;
    const now = Math.floor(Date.now() / 1000);
    getHistory(`${encodeURIComponent(deviceId)}?from=${now - 26 * 3600}&to=${now}&step=300`)
      .then((pts) => { e.points = pts; }, () => { /* the strip stays empty */ })
      .finally(() => { e.pending = false; e.at = Date.now(); rerender(); });
  }
  return e.points;
}

const KIND = [null, 'on', 'off', 'switching']; // not 'switch': that class is the toggle control in ui.js
const pad2 = (n) => String(n).padStart(2, '0');

// 24 hour columns (label "07:00 / 08:00"), each tile split in two half hours. `cells` has 48 entries (1 on, 2 off, 3 switching).
// `nowCell` = current half hour (today only) gets a dot; `actual` adds a thin strip of what the station really saw.
// Three rows (labels, tiles, actual) share one 24 column grid, so everything lines up whatever the width.
function timeline(cells, { nowCell = null, actual = null, mismatch = null, label }) {
  const hoursOf = (fn) => Array.from({ length: 24 }, (_, hh) => fn(hh));
  const cls = (hh) => (nowCell != null && hh * 2 + 1 < nowCell ? ' past' : '') + (hh % 3 === 0 ? ' mark' : '') + (nowCell != null && Math.floor(nowCell / 2) === hh ? ' current' : '');
  const full = (hh) => cells[hh * 2] === 2 && cells[hh * 2 + 1] === 2;

  const labels = h('div', { class: 'hl-row hl-labels', 'aria-hidden': 'true' }, hoursOf((hh) =>
    h('div', { class: 'hl-label' + cls(hh) }, h('span', {}, `${pad2(hh)}:00`), h('span', {}, `${pad2((hh + 1) % 24)}:00`))));

  // Runs of whole off hours: one icon per outage, used instead of per-hour icons when the strip is narrow.
  const runs = [];
  for (let hh = 0; hh < 24; hh++) {
    if (full(hh) && runs.length && runs[runs.length - 1].to === hh) runs[runs.length - 1].to = hh + 1;
    else if (full(hh)) runs.push({ from: hh, to: hh + 1 });
  }
  const tiles = h('div', { class: 'hl-row hl-tiles' },
    hoursOf((hh) => h('div', { class: 'hl-tile' + cls(hh) + (full(hh) ? ' out' : '') },
      [0, 1].map((k) => h('i', { class: `hl-half ${KIND[cells[hh * 2 + k]]}` + (mismatch && mismatch[hh * 2 + k] ? ' bad' : ''), title: `${cellClock(hh * 2 + k)}–${cellClock(hh * 2 + k + 1)}` },
        nowCell === hh * 2 + k && h('b', { class: 'hl-now' }))),
      full(hh) && icon('power_off', 'hl-icon'))),
    runs.map((r) => h('span', { class: 'hl-run', 'aria-hidden': 'true', style: { left: `${(r.from / 24) * 100}%`, width: `${((r.to - r.from) / 24) * 100}%` } }, icon('power_off', 'hl-icon'))));

  const strips = actual && h('div', { class: 'hl-row hl-actuals' }, hoursOf((hh) =>
    h('div', { class: 'hl-actual' + cls(hh) }, [0, 1].map((k) => h('i', { class: 'hl-half ' + (actual[hh * 2 + k] || 'none') })))));

  return h('div', { class: 'hl-block' }, h('div', { class: 'hl', role: 'img', 'aria-label': label }, labels, tiles, strips));
}


const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// One day as chips: "Today · without power 7 h" and a pill per outage window, finished ones dimmed.
function windowsRow(day, labelKey, nowMinutes) {
  if (!day) return null;
  const offs = day.windows.filter((w) => w.kind === 'off');
  const total = offs.reduce((sum, w) => sum + toMin(w.to) - toMin(w.from), 0);
  return h('div', { class: 'win-row' },
    h('div', { class: 'win-day' }, h('b', {}, t(labelKey)), h('span', { class: 'muted small' }, offs.length ? t('outageTotalOff', { d: duration(total / 60) }) : t('outageNoneDay'))),
    offs.length > 0 && h('div', { class: 'win-chips' }, offs.map((w) => h('span', { class: 'win-chip' + (nowMinutes != null && toMin(w.to) <= nowMinutes ? ' past' : '') }, `${w.from}–${w.to}`))));
}

// {status, schedule}: a compact card for the side column and the full-width strip of 24 hours (today, tomorrow).
export function outageCards(deviceId, rerender) {
  const data = outagesFor(rerender);
  if (!data) return null; // first load, or the operator has not been reached yet: show nothing rather than noise
  const a = analyse(data);
  const points = gridPoints(deviceId, rerender);
  const actual = a.today ? actualCells(points, data) : null;
  const nowCell = Math.floor(a.now.minutes / 30);
  const actualNow = actual && actual[nowCell]; // may be null right after midnight
  const mismatch = a.today && actual ? a.today.cells.map((c, i) => c === 1 && actual[i] === 'off') : null;
  const emergency = (data.emergency || []).some((e) => e.date === a.now.date);

  let headline, kind;
  if (!a.today) { headline = t('outageNoToday'); kind = 'none'; }
  else if (a.state === 'off') { headline = a.untilClock ? t('outageNowOff', { t: a.untilClock }) : t('outageNowOffNoEnd'); kind = 'off'; }
  else if (a.state === 'switch') { headline = t('outageNowSwitch'); kind = 'switching'; }
  else { headline = t('outageNowOn'); kind = 'on'; }

  const nextLine = a.next
    ? t(a.next.tomorrow ? 'outageNextTomorrow' : 'outageNext', { from: a.next.from, to: a.next.to, in: duration(a.next.inMin / 60) })
    : a.today && a.state !== 'off' ? t('outageNoMore') : null;

  const outOfSchedule = a.state === 'on' && actualNow === 'off';
  const updated = data.updatedAt ? clock(data.updatedAt) : '–';

  const windows = h('div', { class: 'outage-windows' },
    windowsRow(a.today, 'outageToday', a.now.minutes), windowsRow(a.tomorrow, 'outageTomorrow', null),
    a.today && a.today.volumes.length > 0 && h('div', { class: 'muted small' }, t('outageVolume') + ': ' + a.today.volumes.map((v) => `${v.from}–${v.to} ${String(v.queues).replace('.', getLang() === 'uk' ? ',' : '.')}`).join(' · ')));

  const status = h('section', { class: 'card pad outage-card' },
    h('div', { class: 'outage-head' },
      h('h3', {}, t('outageTitle') + ' · ' + t('outageQueue', { q: data.queue })),
      h('span', { class: 'muted small' }, t('outageUpdated', { t: updated }))),
    h('div', { class: 'outage-status ' + kind }, h('i', { class: 'dot' }), h('b', {}, headline)),
    nextLine && h('div', { class: 'outage-next' }, nextLine),
    actual && actualNow && h('div', { class: 'outage-actual ' + (outOfSchedule ? 'bad' : actualNow) }, t(actualNow === 'on' ? 'outageActualOn' : 'outageActualOff') + (outOfSchedule ? ': ' + t('outageOffScheduleShort') : '')),
    emergency && h('div', { class: 'alert warning' }, h('strong', {}, t('warningBadge')), h('span', {}, t('outageEmergency'))),
    windows,
    (data.stale || data.error) && h('p', { class: 'muted small form-warn' }, data.stale ? t('outageStale', { t: updated }) : t('outageError')));

  const schedule = a.today && h('section', { class: 'card pad outage-strip-card' },
    h('div', { class: 'tl-row' }, h('div', { class: 'tl-label' }, t('outageToday')),
      timeline(a.today.cells, { nowCell, actual, mismatch, label: t('outageToday') })),
    a.tomorrow
      ? h('div', { class: 'tl-row' }, h('div', { class: 'tl-label' }, t('outageTomorrow')), timeline(a.tomorrow.cells, { label: t('outageTomorrow') }))
      : h('p', { class: 'muted small' }, t('outageNoTomorrow')),
    h('div', { class: 'tl-legend' },
      [['on', t('outageLegendOn')], ['off', t('outageLegendOff')], ['switching', t('outageLegendSwitch')]].map(([k, l]) => h('span', {}, h('i', { class: 'hl-half ' + k }), l)),
      h('span', {}, h('i', { class: 'tl-key-actual' }), t('outageActual'))));
  return { status, schedule };
}
