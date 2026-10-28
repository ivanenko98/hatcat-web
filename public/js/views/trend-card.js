// Overview: power over the last 24 hours (sun, grid, home), drawn from the server's own history.
import { h } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { power } from '../fmt.js';
import { getHistory } from '../api.js';
import { lineChart } from '../charts.js';
import { limitSeries } from '../limit-line.js';
import { store } from '../store.js';

const TTL_MS = 2 * 60 * 1000;
const cache = new Map(); // deviceId -> {at, from, to, points, pending}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function load(deviceId, rerender) {
  let e = cache.get(deviceId);
  if (!e) { e = { at: 0, from: 0, to: 0, points: null, pending: false }; cache.set(deviceId, e); }
  if (!e.pending && Date.now() - e.at > TTL_MS) {
    e.pending = true;
    const now = Math.floor(Date.now() / 1000);
    const from = Math.floor((now - 86400) / 3600) * 3600; // start on a whole hour so the axis labels are round
    getHistory(`${encodeURIComponent(deviceId)}?from=${from}&to=${now}&step=600`)
      .then((pts) => { e.points = pts; e.from = from; e.to = now; }, () => { /* leave the box empty */ })
      .finally(() => { e.pending = false; e.at = Date.now(); rerender(); });
  }
  return e;
}

export function trendCard(deviceId, rerender) {
  const e = load(deviceId, rerender);
  const box = h('div', { class: 'trend-box' });
  const locale = getLang() === 'uk' ? 'uk-UA' : 'en-GB';
  const showLimit = store.get('showLimit') !== false; // the same switch as on the history chart

  if (!e.points || e.points.length < 2) {
    box.append(h('p', { class: 'muted small' }, e.points ? t('trendCollecting') : t('loading')));
  } else {
    // Draw once the card is in the page: the chart measures its container's width.
    requestAnimationFrame(() => {
      const hour = (sec, long) => new Date(sec * 1000).toLocaleTimeString(locale, long ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit' });
      const series = [
        { label: t('solar'), color: css('--s-pv'), points: e.points.map((p) => [p.t, p.K5 ?? null]) },
        { label: t('grid'), color: css('--s-grid'), points: e.points.map((p) => [p.t, p.G ?? null]) },
        { label: t('home'), color: css('--s-load'), points: e.points.map((p) => [p.t, p.K13 ?? null]) },
      ];
      if (showLimit) series.push(limitSeries(e.points));
      lineChart(box, series, { from: e.from, to: e.to, height: 170, format: (v) => power(v), xFormat: hour, tableTitle: t('trendTitle') });
    });
  }
  return h('section', { class: 'card pad trend-card' },
    h('div', { class: 'chart-head' }, h('h3', {}, t('trendTitle')),
      h('div', { class: 'chart-tools' },
        h('label', { class: 'check small chart-toggle' }, h('input', { type: 'checkbox', checked: showLimit, onchange: (ev) => { store.set('showLimit', ev.target.checked); rerender(); } }), t('showLimit')),
        h('a', { class: 'link-btn', href: `#/device/${encodeURIComponent(deviceId)}/history` }, t('trendMore')))),
    box);
}
