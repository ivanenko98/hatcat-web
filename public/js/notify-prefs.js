// Which kinds of notification are switched on. Telegram's switches live on the server (telegram.json); the site's
// live in this browser (banner, navigation badge, notifications page and browser pop-ups all follow them).
import { store } from './store.js';

// web: the site can show it; tg: Telegram can send it. A missing channel shows "–" in the table.
export const EVENTS = [
  { key: 'faults', web: true, tg: true },
  { key: 'warnings', web: true, tg: true },
  { key: 'outage', web: true, tg: true },
  { key: 'gridLoad', web: true, tg: true },
  { key: 'outputLoad', web: true, tg: true },
  { key: 'battery', web: true, tg: true },
  { key: 'grid', web: false, tg: true },
  { key: 'cleared', web: false, tg: true },
  { key: 'offline', web: false, tg: true },
  { key: 'session', web: false, tg: true },
];

const read = () => store.get('notifyWeb') || {};

export const webMasterOn = () => read().master !== false;
export const webEnabled = (kind) => webMasterOn() && read()[kind] !== false; // everything is on until switched off

export function setWeb(kind, on) {
  const prefs = read();
  prefs[kind] = on;
  store.set('notifyWeb', prefs);
}
export function setWebMaster(on) { setWeb('master', on); }
