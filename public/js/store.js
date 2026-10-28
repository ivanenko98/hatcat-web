// localStorage wrapper: every access may throw (private mode, blocked storage).
const PREFIX = 'hc_';

export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(PREFIX + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(PREFIX + k); } catch {} },
};
