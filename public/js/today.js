// Today's maximum / minimum / average per register, computed by the server from its own history
// (the phone app gets the same numbers from the cloud's daily statistics, which we cannot read).
import { getHistory } from './api.js';
import { KMAP } from './regs.js';

const TTL_MS = 60 * 1000;
const cache = new Map(); // deviceId|date -> {at, data, pending}

// Today's date in the device's own time zone, as the server files its history.
export function todayIn(zone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Returns the extremes object (or null while loading / when nothing is recorded) and refetches when stale.
export function todayFor(deviceId, zone, rerender) {
  const date = todayIn(zone);
  const key = `${deviceId}|${date}`;
  let e = cache.get(key);
  if (!e) { e = { at: 0, data: null, pending: false }; cache.set(key, e); }
  if (!e.pending && Date.now() - e.at > TTL_MS) {
    e.pending = true;
    getHistory(`${encodeURIComponent(deviceId)}/extremes?date=${date}`)
      .then((d) => { e.data = d; }, () => { /* history is optional: keep the rows hidden */ })
      .finally(() => { e.pending = false; e.at = Date.now(); rerender(); });
  }
  return e.data && e.data.samples > 0 ? e.data : null;
}

// One register's extremes scaled to real units: {max:{v,t}, min:{v,t}, avg} or null.
export function stat(data, reg) {
  const e = data?.keys?.[reg];
  if (!e || !e.max) return null;
  const k = KMAP[reg]?.scale || 1;
  const sc = (p) => (p ? { v: +(p.v * k).toFixed(3), t: p.t } : null);
  return { max: sc(e.max), min: sc(e.min), avg: e.avg == null ? null : +(e.avg * k).toFixed(3) };
}
