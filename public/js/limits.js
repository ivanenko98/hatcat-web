// Main breaker limits, kept on our server so the web UI and Telegram agree. Until they load the defaults apply.
import { local } from './api.js';

const DEFAULTS = { breakerA: 25, warnPct: 80, alarmPct: 95, inverterW: 4200 };
let limits = { ...DEFAULTS };
let loaded = false;

export const getLimits = () => limits;

export async function loadLimits(rerender) {
  if (loaded) return;
  try { limits = await local('limits'); loaded = true; if (rerender) rerender(); } catch { /* keep the defaults */ }
}

export async function saveLimits(patch) {
  limits = await local('limits', patch);
  loaded = true;
  return limits;
}

export function forgetLimits() { loaded = false; limits = { ...DEFAULTS }; }
