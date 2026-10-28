// Dashboard card: planned outage schedule for today and tomorrow, what the station really saw, and mismatches.
import { h } from '../dom.js';
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

const KIND = [null, 'on', 'off', 'switch'];

// 48 cells; `marker` = current half hour index (today only); `actual` draws a second, thinner strip.
function timeline(cells, { nowCell = null, actual = null, mismatch = null, label }) {
  const bar = h('div', { class: 'tl', role: 'img', 'aria-label': label },
    cells.map((c, i) => h('i', { class: `tl-cell ${KIND[c]}` + (nowCell != null && i < nowCell ? ' past' : '') + (mismatch && mismatch[i] ? ' bad' : ''), title: `${cellClock(i)}–${cellClock(i + 1)}` })),
    nowCell != null && h('b', { class: 'tl-now', style: { left: ((nowCell + 0.5) / 48) * 100 + '%' } }));
  const strip = actual && h('div', { class: 'tl tl-actual', role: 'img', 'aria-label': t('outageActual') },
    actual.map((c, i) => h('i', { class: 'tl-cell ' + (c || 'none'), title: `${cellClock(i)}–${cellClock(i + 1)}` })));
  const ticks = h('div', { class: 'tl-ticks', 'aria-hidden': 'true' }, [0, 3, 6, 9, 12, 15, 18, 21].map((hh) => h('span', { style: { left: (hh / 24) * 100 + '%' } }, String(hh).padStart(2, '0'))));
  return h('div', { class: 'tl-block' }, bar, strip, ticks);
}

const windowText = (day) => (day && day.windows.filter((w) => w.kind === 'off').map((w) => `${w.from}–${w.to}`).join(', ')) || null;

export function outageCard(deviceId, rerender) {
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
  else if (a.state === 'switch') { headline = t('outageNowSwitch'); kind = 'switch'; }
  else { headline = t('outageNowOn'); kind = 'on'; }

  const nextLine = a.next
    ? t(a.next.tomorrow ? 'outageNextTomorrow' : 'outageNext', { from: a.next.from, to: a.next.to, in: duration(a.next.inMin / 60) })
    : a.today && a.state !== 'off' ? t('outageNoMore') : null;

  const outOfSchedule = a.state === 'on' && actualNow === 'off';
  const updated = data.updatedAt ? clock(data.updatedAt) : '–';

  return h('section', { class: 'card pad outage-card' },
    h('div', { class: 'outage-head' },
      h('h3', {}, t('outageTitle') + ' · ' + t('outageQueue', { q: data.queue })),
      h('span', { class: 'muted small' }, t('outageUpdated', { t: updated }))),
    h('div', { class: 'outage-status ' + kind }, h('i', { class: 'dot' }), h('b', {}, headline)),
    nextLine && h('div', { class: 'outage-next' }, nextLine),
    actual && actualNow && h('div', { class: 'outage-actual ' + (outOfSchedule ? 'bad' : actualNow) }, t(actualNow === 'on' ? 'outageActualOn' : 'outageActualOff') + (outOfSchedule ? ': ' + t('outageOffScheduleShort') : '')),
    emergency && h('div', { class: 'alert warning' }, h('strong', {}, t('warningBadge')), h('span', {}, t('outageEmergency'))),
    a.today && h('div', { class: 'tl-row' }, h('div', { class: 'tl-label' }, t('outageToday')),
      timeline(a.today.cells, { nowCell, actual, mismatch, label: t('outageToday') })),
    a.today && h('div', { class: 'tl-legend' },
      [['on', t('outageLegendOn')], ['off', t('outageLegendOff')], ['switch', t('outageLegendSwitch')]].map(([k, l]) => h('span', {}, h('i', { class: 'tl-cell ' + k }), l)),
      h('span', {}, h('i', { class: 'tl-cell tl-key-actual' }), t('outageActual'))),
    a.tomorrow
      ? h('div', { class: 'tl-row' }, h('div', { class: 'tl-label' }, t('outageTomorrow')), timeline(a.tomorrow.cells, { label: t('outageTomorrow') }))
      : a.today && h('p', { class: 'muted small' }, t('outageNoTomorrow')),
    h('div', { class: 'outage-windows small' },
      windowText(a.today) && h('div', {}, h('b', {}, t('outageToday') + ': '), windowText(a.today)),
      windowText(a.tomorrow) && h('div', {}, h('b', {}, t('outageTomorrow') + ': '), windowText(a.tomorrow)),
      a.today && a.today.volumes.length > 0 && h('div', { class: 'muted' }, t('outageVolume') + ': ' + a.today.volumes.map((v) => `${v.from}–${v.to} ${String(v.queues).replace('.', getLang() === 'uk' ? ',' : '.')}`).join(' · '))),
    (data.stale || data.error) && h('p', { class: 'muted small form-warn' }, data.stale ? t('outageStale', { t: updated }) : t('outageError')),
  );
}
