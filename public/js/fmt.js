import { t, getLang } from './i18n.js';

export function num(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '–';
  return v.toLocaleString(getLang() === 'uk' ? 'uk-UA' : 'en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Power reads better in kW above 1000 W.
export function power(w) {
  if (w == null || !Number.isFinite(w)) return '–';
  return Math.abs(w) >= 1000 ? num(w / 1000, 2) + ' kW' : num(w) + ' W';
}

export function unit(v, u, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '–';
  if (u === 'W') return power(v);
  return num(v, digits) + (u ? ' ' + u : '');
}

// "2 h 36 min" for an estimate in hours.
export function duration(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return '';
  const total = Math.round(hours * 60);
  const hh = Math.floor(total / 60), mm = total % 60;
  return hh ? t('durHour', { h: hh, m: mm }) : t('durMin', { m: mm });
}

// Bare elapsed time for phrases like "offline for 12 min".
export function elapsed(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return t('durMin', { m: Math.max(1, Math.floor(s / 60)) });
  if (s < 86400) return t('durHour', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) });
  return t('durDay', { n: Math.floor(s / 86400) });
}

export function time(ms) {
  return new Date(ms).toLocaleTimeString(getLang() === 'uk' ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// "15:50" for a timestamp in the viewer's own time zone.
export function clock(ms) {
  return new Date(ms).toLocaleTimeString(getLang() === 'uk' ? 'uk-UA' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}

// "28.10.2026 22:01:30" for a timestamp in the viewer's own time zone.
export function datetime(ms) {
  return new Date(ms).toLocaleString(getLang() === 'uk' ? 'uk-UA' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
