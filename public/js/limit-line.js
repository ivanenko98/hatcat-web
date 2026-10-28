// The power limit drawn on the power charts: a stepped, red, dashed line that follows what feeds the house.
// While the grid does (Line/Bypass) the limit is the main breaker (rating x grid volts), otherwise the inverter rating.
import { t } from './i18n.js';
import { getLimits } from './limits.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// [unix, watts, 'grid' | 'battery'] for one history point (K1 mode and K2 grid volts x 10 come with it).
export function limitPoint(p) {
  const lim = getLimits();
  const gridV = (p.K2 || 0) / 10;
  const onGrid = (p.K1 === 4 || p.K1 === 5) && gridV >= 100;
  return [p.t, onGrid ? Math.round(lim.breakerA * gridV) : lim.inverterW, onGrid ? 'grid' : 'battery'];
}

// Hold the previous value until the instant of a change, so the line steps instead of sloping between samples.
export function stepped(points) {
  const out = [];
  for (const pt of points) {
    const prev = out[out.length - 1];
    if (prev && prev[1] !== pt[1] && pt[0] - prev[0] <= 900) out.push([pt[0] - 1, prev[1], prev[2]]);
    out.push(pt);
  }
  return out;
}

// A chart series ready for lineChart().
export function limitSeries(historyPoints) {
  const lim = getLimits();
  return {
    label: t('limitLine'), color: css('--bad'), dashed: true, points: stepped(historyPoints.map(limitPoint)),
    labelOf: (p) => (p[2] === 'grid' ? t('limitGridTip', { a: lim.breakerA }) : t('limitBatteryTip')),
  };
}
