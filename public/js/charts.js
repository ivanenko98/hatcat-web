// Small SVG charts without libraries: a time-series line chart and a grouped bar chart.
// Both draw at the container's current pixel width, have a hover tooltip, a legend
// for 2+ series and a table view, so no reading depends on colour alone.
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

// 0 / nice step ticks covering [min, max].
function ticks(min, max, count = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw);
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(+v.toFixed(6));
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

function legend(series) {
  if (series.length < 2) return null;
  return h('div', { class: 'chart-legend' }, series.map((sr) =>
    h('span', { class: 'legend-item' }, h('i', { style: sr.dashed
      ? { background: `repeating-linear-gradient(90deg, ${sr.color} 0 5px, transparent 5px 8px)`, height: '3px', borderRadius: '0' }
      : { background: sr.color } }), sr.label)));
}

function tooltipBox() {
  return h('div', { class: 'chart-tip', role: 'status', hidden: true });
}
function placeTip(tip, wrap, x, y, rows, title) {
  tip.replaceChildren(h('div', { class: 'tip-title' }, title),
    ...rows.map(([label, value, color]) => h('div', { class: 'tip-row' },
      color && h('i', { style: { background: color } }), h('span', {}, label), h('b', {}, value))));
  tip.hidden = false;
  const w = wrap.clientWidth, tw = tip.offsetWidth;
  tip.style.left = Math.min(Math.max(0, x + 14), w - tw) + 'px';
  if (x + 14 + tw > w) tip.style.left = Math.max(0, x - tw - 14) + 'px';
  tip.style.top = Math.max(0, y - 10) + 'px';
}

/**
 * Line chart over time.
 * series: [{label, color, points: [[unixSec, value|null], ...], area?: bool}]
 * opts: {from, to, height, yMin, yMax, format(v), xFormat(t), tableTitle}
 */
export function lineChart(container, series, opts) {
  const W = Math.max(280, container.clientWidth || 600);
  const H = opts.height || 220;
  const iw = W - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
  const all = series.flatMap((sr) => sr.points.map((p) => p[1]).filter((v) => v != null));
  const yMin = opts.yMin ?? Math.min(0, ...all);
  const yMax = opts.yMax ?? Math.max(1, ...all);
  const yt = ticks(yMin, yMax);
  const y0 = yt[0], y1 = yt[yt.length - 1];
  const x = (t) => PAD.left + ((t - opts.from) / (opts.to - opts.from)) * iw;
  const y = (v) => PAD.top + ih - ((v - y0) / (y1 - y0)) * ih;

  const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': opts.tableTitle });
  for (const v of yt) {
    svg.append(s('line', { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
    svg.append(s('text', { x: PAD.left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, opts.format(v)));
  }
  const hours = (opts.to - opts.from) / 3600;
  // Ticks count from opts.from, which callers pass as local midnight, so labels land on 00, 03, 06 …
  const xStep = (hours <= 26 ? (W < 500 ? 6 : 3) : 24) * 3600;
  for (let t = opts.from; t <= opts.to; t += xStep) {
    svg.append(s('text', { x: x(t), y: H - 6, 'text-anchor': 'middle', class: 'tick' }, opts.xFormat(t)));
  }
  // Break lines where samples are missing for more than 15 minutes.
  for (const sr of series) {
    let d = '', prev = null;
    const segs = [];
    for (const [t, v] of sr.points) {
      if (v == null) { prev = null; continue; }
      const gap = prev && t - prev > 900;
      if (!prev || gap) { if (d) segs.push(d); d = `M${x(t).toFixed(1)},${y(v).toFixed(1)}`; }
      else d += `L${x(t).toFixed(1)},${y(v).toFixed(1)}`;
      prev = t;
    }
    if (d) segs.push(d);
    for (const seg of segs) {
      if (sr.area && !sr.dashed) {
        const pts = seg.slice(1).split('L');
        const first = pts[0].split(',')[0], last = pts[pts.length - 1].split(',')[0];
        svg.append(s('path', { d: `${seg}L${last},${y(Math.max(y0, 0))}L${first},${y(Math.max(y0, 0))}Z`, fill: sr.color, class: 'area' }));
      }
      svg.append(s('path', { d: seg, stroke: sr.color, class: 'line' + (sr.dashed ? ' ref' : ''), 'stroke-dasharray': sr.dashed ? '9 6' : null }));
    }
  }

  const cross = s('line', { y1: PAD.top, y2: PAD.top + ih, class: 'crosshair', visibility: 'hidden' });
  const dots = series.map((sr) => s('circle', { r: 4, fill: sr.color, class: 'hover-dot', visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const hit = s('rect', { x: PAD.left, y: PAD.top, width: iw, height: ih, fill: 'transparent' });
  svg.append(hit);

  const tip = tooltipBox();
  const wrap = h('div', { class: 'chart-wrap' }, svg, tip);
  const nearest = (pts, t) => {
    let best = null;
    for (const p of pts) if (p[1] != null && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p;
    return best && Math.abs(best[0] - t) < 1800 ? best : null;
  };
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const t = opts.from + ((px - PAD.left) / iw) * (opts.to - opts.from);
    const rows = [];
    let anyT = null;
    series.forEach((sr, i) => {
      const p = nearest(sr.points, t);
      if (!p) { dots[i].setAttribute('visibility', 'hidden'); return; }
      anyT = anyT ?? p[0];
      dots[i].setAttribute('cx', x(p[0])); dots[i].setAttribute('cy', y(p[1])); dots[i].setAttribute('visibility', sr.dashed ? 'hidden' : 'visible');
      rows.push([sr.labelOf ? sr.labelOf(p) : sr.label, opts.format(p[1]), sr.color]);
    });
    if (anyT == null) { leave(); return; }
    cross.setAttribute('x1', x(anyT)); cross.setAttribute('x2', x(anyT)); cross.setAttribute('visibility', 'visible');
    placeTip(tip, wrap, x(anyT), ev.clientY - rect.top, rows, opts.xFormat(anyT, true));
  };
  const leave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);

  container.replaceChildren(...[legend(series), wrap].filter(Boolean));
}

/**
 * Grouped bars per category.
 * categories: [label], series: [{label, color, values: [number|null]}]
 * opts: {height, format(v), tableTitle}
 */
export function barChart(container, categories, series, opts) {
  const W = Math.max(280, container.clientWidth || 600);
  const H = opts.height || 220;
  const iw = W - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
  const all = series.flatMap((sr) => sr.values.filter((v) => v != null));
  const yt = ticks(0, Math.max(1, ...all));
  const y1 = yt[yt.length - 1];
  const y = (v) => PAD.top + ih - (v / y1) * ih;
  const band = iw / categories.length;
  const gap = 2; // surface gap between neighbouring bars
  const barW = Math.max(2, Math.min(18, (band * 0.75 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);

  const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': opts.tableTitle });
  for (const v of yt) {
    svg.append(s('line', { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
    svg.append(s('text', { x: PAD.left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, opts.format(v)));
  }
  const labelEvery = Math.ceil(categories.length / Math.max(1, Math.floor(iw / 44)));
  const tip = tooltipBox();
  const wrap = h('div', { class: 'chart-wrap' }, svg, tip);
  categories.forEach((cat, ci) => {
    const gx = PAD.left + ci * band + (band - groupW) / 2;
    series.forEach((sr, si) => {
      const v = sr.values[ci];
      if (!v) return;
      const bx = gx + si * (barW + gap), top = y(v), r = Math.min(4, barW / 2, (PAD.top + ih - top) / 2);
      // Rounded data end, square at the baseline.
      svg.append(s('path', {
        fill: sr.color,
        d: `M${bx},${PAD.top + ih}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + barW - r}Q${bx + barW},${top} ${bx + barW},${top + r}V${PAD.top + ih}Z`,
      }));
    });
    if (ci % labelEvery === 0) svg.append(s('text', { x: PAD.left + ci * band + band / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' }, cat));
    // Hit target spans the whole band, bigger than the bars.
    const hit = s('rect', { x: PAD.left + ci * band, y: PAD.top, width: band, height: ih, fill: 'transparent', class: 'band-hit' });
    const show = (ev) => {
      const rect = svg.getBoundingClientRect();
      placeTip(tip, wrap, PAD.left + ci * band + band / 2, ev.clientY - rect.top, series.map((sr) => [sr.label, opts.format(sr.values[ci]), sr.color]), opts.categoryTitle?.(ci) ?? cat);
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { tip.hidden = true; });
    svg.append(hit);
  });
  container.replaceChildren(...[legend(series), wrap].filter(Boolean));
}

// Collapsible table with the same numbers as a chart.
export function dataTable(summary, head, rows) {
  return h('details', { class: 'chart-table' },
    h('summary', {}, summary),
    h('div', { class: 'table-scroll' },
      h('table', {},
        h('thead', {}, h('tr', {}, head.map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: i ? 'num' : '' }, c))))),
      )),
  );
}
