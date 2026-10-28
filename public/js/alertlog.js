// The server's own fault/warning log (from its recorded history), cached for a minute per device.
import { getHistory } from './api.js';

const TTL_MS = 60 * 1000;
const cache = new Map(); // deviceId -> {at, events, pending}

export function logFor(deviceId, rerender) {
  const id = String(deviceId);
  let e = cache.get(id);
  if (!e) { e = { at: 0, events: null, pending: false }; cache.set(id, e); }
  if (!e.pending && Date.now() - e.at > TTL_MS) {
    e.pending = true;
    getHistory(`${encodeURIComponent(id)}/alerts?days=30`)
      .then((ev) => { e.events = ev; }, () => { /* the log is optional */ })
      .finally(() => { e.pending = false; e.at = Date.now(); rerender(); });
  }
  return e.events;
}
