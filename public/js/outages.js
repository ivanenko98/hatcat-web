// Planned outage schedule (queue chosen in the profile) as served by our /outages endpoint, plus the helpers
// the dashboard and the alerts use. Cells are half hours: 1 = power on, 2 = outage, 3 = switching (power may be absent).
import { local } from './api.js';

const TTL_MS = 60 * 1000;
let cache = { at: 0, data: null, pending: false };

export const getOutages = () => cache.data;
export function forgetOutages() { cache = { at: 0, data: null, pending: false }; }

// Returns the cached schedule at once and refetches when stale; rerender runs when the new data lands.
export function outagesFor(rerender) {
  if (!cache.pending && Date.now() - cache.at > TTL_MS) {
    cache.pending = true;
    local('outages')
      .then((d) => { cache.data = d; }, () => { /* keep the previous data, the card shows it as stale */ })
      .finally(() => { cache.pending = false; cache.at = Date.now(); rerender(); });
  }
  return cache.data;
}

export async function saveQueue(queue) {
  cache.data = await local('outages', { queue });
  cache.at = Date.now();
  return cache.data;
}

// Date (YYYY-MM-DD) and minutes since midnight at `ms` in the grid operator's zone.
export function zoned(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const cellClock = (cell) => `${String(Math.floor(cell / 2)).padStart(2, '0')}:${cell % 2 ? '30' : '00'}`;
const KIND = [null, 'on', 'off', 'switch'];

// State at a moment: 'on' | 'off' | 'switch' | null (no data for that day).
export function stateAt(data, ms) {
  if (!data || data.stale) return null;
  const { date, minutes } = zoned(ms, data.tz);
  const day = data.days.find((d) => d.date === date);
  return day && day.cells ? KIND[day.cells[Math.floor(minutes / 30)]] : null;
}

// Everything the card shows for "now": current state, when it ends, the next outage, today's and tomorrow's days.
export function analyse(data, ms = Date.now()) {
  const now = zoned(ms, data.tz);
  const today = data.days.find((d) => d.date === now.date) || null;
  const tomorrow = data.days.find((d) => d.date === addDays(now.date, 1)) || null;
  const cellNow = Math.floor(now.minutes / 30);
  const state = today && today.cells ? KIND[today.cells[cellNow]] : null;
  // walk forward through today's and tomorrow's cells
  const seq = [];
  if (today) today.cells.forEach((c, i) => seq.push({ day: 0, i, c }));
  if (tomorrow) tomorrow.cells.forEach((c, i) => seq.push({ day: 1, i, c }));
  const here = seq.findIndex((x) => x.day === 0 && x.i === cellNow);
  let until = null, next = null;
  if (here >= 0) {
    for (let k = here + 1; k < seq.length; k++) {
      if (!until && seq[k].c !== seq[here].c) until = seq[k];
      if (!next && seq[k].c === 2 && seq[k - 1].c !== 2) { next = seq[k]; }
      if (until && next) break;
    }
  }
  const startsIn = (x) => (x.day * 1440 + x.i * 30) - now.minutes;
  let nextWindow = null;
  if (next) {
    let end = seq.findIndex((x, k) => k > seq.indexOf(next) && x.c !== 2);
    const e = end < 0 ? next : seq[end];
    nextWindow = { from: cellClock(next.i), to: end < 0 ? '24:00' : cellClock(e.i), tomorrow: next.day === 1, inMin: startsIn(next) };
  }
  return { now, state, untilClock: until ? cellClock(until.i) : null, untilTomorrow: !!until && until.day === 1, next: nextWindow, today, tomorrow };
}

// The station's real grid, per half hour of today, from the server's recorded history:
// 'on' | 'off' | null (no data). Points carry K2 (grid volts x 10); the grid counts as present above 100 V.
export function actualCells(points, data, ms = Date.now()) {
  const cells = Array(48).fill(null);
  const sums = Array.from({ length: 48 }, () => ({ on: 0, off: 0 }));
  const today = zoned(ms, data.tz).date;
  for (const p of points) {
    const z = zoned(p.t * 1000, data.tz);
    if (z.date !== today) continue;
    sums[Math.floor(z.minutes / 30)][(p.K2 || 0) / 10 > 100 ? 'on' : 'off']++;
  }
  sums.forEach((s, i) => { if (s.on + s.off) cells[i] = s.on >= s.off ? 'on' : 'off'; });
  return cells;
}
