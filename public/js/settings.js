// mas_settings changes rarely (the inverter uploads it about once a day), so fetch it lazily
// and keep it for ten minutes instead of polling it with the telemetry.
import { getDeviceSettings } from './api.js';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // deviceId -> {at, regs, error, pending}

// Returns {regs, error} immediately; starts a fetch when stale and calls rerender once it lands.
export function settingsFor(deviceId, rerender) {
  const id = String(deviceId);
  let e = cache.get(id);
  if (!e) { e = { at: 0, regs: null, error: null, pending: false }; cache.set(id, e); }
  if (!e.pending && Date.now() - e.at > TTL_MS) {
    e.pending = true;
    getDeviceSettings(id)
      .then((j) => { e.regs = j.mas_settings || null; e.error = null; }, (err) => { e.error = err; })
      .finally(() => { e.pending = false; e.at = Date.now(); rerender(); });
  }
  return { regs: e.regs, error: e.error, loading: e.pending && !e.regs };
}

// Registers arrive as strings; unknown or missing ones stay null.
export function reg(regs, name) {
  const n = Number(regs?.[name]);
  return regs && regs[name] != null && Number.isFinite(n) ? n : null;
}

export function forgetSettings() { cache.clear(); }
