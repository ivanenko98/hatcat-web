import { h } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { num, power } from '../fmt.js';
import { getHistory } from '../api.js';
import { lineChart, barChart, dataTable } from '../charts.js';
import { deviceHead } from './device-head.js';
import { errorText } from './login.js';
import { limitPoint, limitSeries } from '../limit-line.js';
import { store } from '../store.js';

const CACHE_MS = 60 * 1000;
const DAY_STEP_S = 300;

// Survives the 30 s re-render of the device screen.
const state = { period: 'day', anchor: null, key: null, loadedAt: 0, result: null, error: null, pending: null };

const locale = () => (getLang() === 'uk' ? 'uk-UA' : 'en-GB');
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const kwh = (wh) => (wh == null ? '–' : num(wh / 1000, wh < 10000 ? 2 : 1) + ' kWh');

// Chart series colours live in CSS (--s-*) so dark mode gets its own validated steps.
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function rangeFor(period, anchor) {
  const end = startOfDay(anchor);
  if (period === 'day') return { from: end, to: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) };
  const days = period === 'week' ? 7 : 30;
  return { from: new Date(end.getFullYear(), end.getMonth(), end.getDate() - days + 1), to: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) };
}

async function load(deviceId) {
  const { from, to } = rangeFor(state.period, state.anchor);
  const id = encodeURIComponent(deviceId);
  const lastDay = new Date(to - 86400000);
  const [status, days, points] = await Promise.all([
    getHistory('status'),
    getHistory(`${id}/days?from=${ymd(from)}&to=${ymd(lastDay)}`),
    state.period === 'day' ? getHistory(`${id}?from=${from / 1000}&to=${to / 1000 - 1}&step=${DAY_STEP_S}`) : null,
  ]);
  return { status, days, points, from, to };
}


export function historyView(root, { data, deviceId, rerender }) {
  const d = (data.json?.devices || []).find((x) => String(x.device_id) === String(deviceId));
  if (!d) { location.hash = '#/devices'; return; }
  if (!state.anchor) state.anchor = new Date();

  const key = `${deviceId}|${state.period}|${ymd(state.anchor)}`;
  const stale = key !== state.key || Date.now() - state.loadedAt > CACHE_MS;
  if (stale && state.pending !== key) {
    state.pending = key;
    load(deviceId).then((result) => { state.result = result; state.error = null; }, (e) => { state.error = errorText(e); })
      .finally(() => { state.key = key; state.loadedAt = Date.now(); state.pending = null; rerender(); });
  }

  const shift = (dir) => {
    const step = state.period === 'day' ? 1 : state.period === 'week' ? 7 : 30;
    const next = new Date(state.anchor);
    next.setDate(next.getDate() + dir * step);
    if (next > new Date()) return;
    state.anchor = next;
    rerender();
  };
  const isToday = ymd(state.anchor) === ymd(new Date());
  const { from, to } = rangeFor(state.period, state.anchor);
  const fmtDate = (dt, opts) => dt.toLocaleDateString(locale(), opts);
  const label = state.period === 'day'
    ? fmtDate(from, { weekday: 'short', day: 'numeric', month: 'long' })
    : `${fmtDate(from, { day: 'numeric', month: 'short' })} – ${fmtDate(new Date(to - 86400000), { day: 'numeric', month: 'short' })}`;

  const controls = h('div', { class: 'history-controls' },
    h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('period') },
      ['day', 'week', 'month'].map((p) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(state.period === p), class: state.period === p ? 'on' : '',
        onclick: () => { state.period = p; rerender(); },
      }, t('period_' + p)))),
    h('div', { class: 'date-nav' },
      h('button', { class: 'btn ghost', type: 'button', 'aria-label': t('previous'), onclick: () => shift(-1) }, '‹'),
      h('span', { class: 'date-label' }, label),
      h('button', { class: 'btn ghost', type: 'button', 'aria-label': t('next'), disabled: isToday, onclick: () => shift(1) }, '›'),
    ),
  );

  const body = h('div', { class: 'history-body' });
  root.replaceChildren(...deviceHead(d, 'history'), controls, body);

  const r = state.key === key ? state.result : null;
  if (state.error && state.key === key) { body.replaceChildren(h('div', { class: 'card pad form-err' }, state.error)); return; }
  if (!r) { body.replaceChildren(h('div', { class: 'loading' }, t('loading'))); return; }

  const banner = !r.status.recording && h('div', { class: 'banner warn' }, t('historyPaused'));
  const total = (k) => r.days.reduce((a, day) => a + (day[k] || 0), 0);
  const socs = r.days.flatMap((day) => [day.socMin, day.socMax]).filter((v) => v != null);
  const samples = r.days.reduce((a, day) => a + day.samples, 0);
  const tiles = h('div', { class: 'stat-tiles' },
    tile(t('pvProduced'), kwh(total('pvWh')), '--s-pv'),
    tile(t('consumed'), kwh(total('loadWh')), '--s-load'),
    tile(t('fromGrid'), kwh(total('gridWh')), '--s-grid'),
    tile(t('socRange'), socs.length ? `${Math.min(...socs)}–${Math.max(...socs)} %` : '–', '--c-bat'),
  );
  if (!samples) {
    body.replaceChildren(...[banner, h('div', { class: 'card pad empty-history' }, h('p', {}, t('historyEmpty')), h('p', { class: 'muted small' }, t('historyEmptyHint')))].filter(Boolean));
    return;
  }

  const showLimit = store.get('showLimit') !== false;
  const limitToggle = h('label', { class: 'check small chart-toggle' },
    h('input', { type: 'checkbox', checked: showLimit, onchange: (e) => { store.set('showLimit', e.target.checked); rerender(); } }), t('showLimit'));
  const powerCard = h('section', { class: 'card chart-card' }, h('div', { class: 'chart-head' }, h('h3', {}, t('powerChart')), limitToggle));
  const socCard = h('section', { class: 'card chart-card' }, h('h3', {}, t('socChart')));
  const barsCard = h('section', { class: 'card chart-card' }, h('h3', {}, t('energyChart')));
  body.replaceChildren(...[banner, tiles].filter(Boolean), ...(state.period === 'day' ? [powerCard, socCard] : [barsCard]));

  if (state.period === 'day') {
    const pts = r.points;
    const series = [
      { label: t('solar'), color: css('--s-pv'), points: pts.map((p) => [p.t, p.K5 ?? null]) },
      { label: t('grid'), color: css('--s-grid'), points: pts.map((p) => [p.t, p.G ?? null]) },
      { label: t('home'), color: css('--s-load'), points: pts.map((p) => [p.t, p.K13 ?? null]) },
    ];
    const xFormat = (sec, long) => new Date(sec * 1000).toLocaleTimeString(locale(), long ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit' });
    const opts = { from: from / 1000, to: to / 1000, xFormat };
    if (showLimit) series.push(limitSeries(pts));
    const powerBox = h('div', {});
    const socBox = h('div', {});
    powerCard.append(powerBox, dataTable(t('showTable'), [t('time'), t('solar'), t('grid'), t('home'), t('limitLine')],
      pts.map((p) => [xFormat(p.t, true), power(p.K5), power(p.G), power(p.K13), power(limitPoint(p)[1])])));
    socCard.append(socBox);
    lineChart(powerBox, series, { ...opts, height: 240, format: (v) => power(v), tableTitle: t('powerChart') });
    lineChart(socBox, [{ label: t('soc'), color: css('--c-bat'), area: true, points: pts.map((p) => [p.t, p.K7 ?? null]) }],
      { ...opts, height: 160, yMin: 0, yMax: 100, format: (v) => num(v) + ' %', tableTitle: t('socChart') });
  } else {
    const cats = r.days.map((day) => new Date(day.date + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: state.period === 'week' ? 'short' : 'numeric' }));
    const box = h('div', {});
    barsCard.append(box, dataTable(t('showTable'), [t('date'), t('solar'), t('grid'), t('home'), t('socRange')],
      r.days.map((day, i) => [cats[i], kwh(day.pvWh), kwh(day.gridWh), kwh(day.loadWh), day.socMin == null ? '–' : `${day.socMin}–${day.socMax} %`])));
    barChart(box, cats, [
      { label: t('solar'), color: css('--s-pv'), values: r.days.map((day) => (day.samples ? day.pvWh : null)) },
      { label: t('grid'), color: css('--s-grid'), values: r.days.map((day) => (day.samples ? day.gridWh : null)) },
      { label: t('home'), color: css('--s-load'), values: r.days.map((day) => (day.samples ? day.loadWh : null)) },
    ], {
      height: 240, format: (v) => (v == null ? '–' : num(v / 1000, 1) + ' kWh'), tableTitle: t('energyChart'),
      categoryTitle: (i) => new Date(r.days[i].date + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' }),
    });
  }
}

function tile(label, value, color) {
  return h('div', { class: 'card stat-tile', style: { '--tile-c': `var(${color})` } },
    h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value));
}
