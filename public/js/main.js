import { h } from './dom.js';
import { t } from './i18n.js';
import { applyTheme } from './theme.js';
import { getSession, sessionValid, onSessionEnd, getMyDevices } from './api.js';
import { loginView, errorText } from './views/login.js';
import { devicesView } from './views/devices.js';
import { stationView } from './views/station.js';
import { profileView } from './views/profile.js';
import { historyView } from './views/history.js';
import { settingsView } from './views/settings.js';
import { forgetSettings } from './settings.js';
import { loadLimits, forgetLimits } from './limits.js';
import { notificationsView } from './views/notifications.js';
import { alertsByDevice } from './alerts.js';
import { deviceTitle } from './regs.js';
import { store } from './store.js';

const REFRESH_MS = 30000;
const main = document.getElementById('main');
const nav = document.getElementById('nav');

// Latest m_get_my_device response, shared by every view.
const data = { json: null, error: null, loading: false };
let timer = null;
let loginNotice = '';
let listSeen = false; // open the only device directly, but once per page load

applyTheme();

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'devices', id: parts[1], sub: parts[2] };
}

function renderNav(route) {
  const loggedIn = sessionValid();
  const count = data.json ? alertsByDevice(data.json).reduce((n, i) => n + i.alerts.length, 0) : 0;
  nav.replaceChildren(...(loggedIn ? [
    h('a', { href: '#/devices', class: route.name === 'devices' || route.name === 'device' ? 'on' : '' }, t('devices')),
    h('a', { href: '#/notifications', class: route.name === 'notifications' ? 'on' : '' }, t('notifications'),
      count > 0 && h('span', { class: 'nav-badge', 'aria-label': String(count) }, count)),
    h('a', { href: '#/profile', class: route.name === 'profile' ? 'on' : '' }, t('profile')),
  ] : []));
}

function render() {
  const route = parseRoute();
  renderNav(route);
  if (!sessionValid()) {
    stopPolling();
    loginView(main, { notice: loginNotice, onDone: () => { loginNotice = ''; location.hash = '#/devices'; refresh(); } });
    return;
  }
  if (route.name === 'profile') { profileView(main, { rerender: render }); return; }
  if (!data.json) {
    main.replaceChildren(data.error
      ? h('div', { class: 'card pad' }, h('p', { class: 'form-err' }, data.error), h('button', { class: 'btn', onclick: refresh }, t('refresh')))
      : h('div', { class: 'loading' }, t('loading')));
    return;
  }
  if (route.name === 'notifications') { notificationsView(main, { data, rerender: render }); return; }
  const devices = data.json.devices || [];
  if (route.name === 'device' && route.id && route.sub === 'history') { historyView(main, { data, deviceId: route.id, rerender: render }); return; }
  if (route.name === 'device' && route.id && route.sub === 'settings') { settingsView(main, { data, deviceId: route.id, rerender: render }); return; }
  if (route.name === 'device' && route.id) { stationView(main, { data, deviceId: route.id, rerender: render }); return; }
  // A single device needs no list.
  if (route.name === 'devices' && devices.length === 1 && !listSeen) {
    listSeen = true;
    location.replace(`#/device/${encodeURIComponent(devices[0].device_id)}`);
    return;
  }
  devicesView(main, { data });
}

// Browser notification for every alert that was not there on the previous poll (tab must be open).
let seenAlerts = null;
function notifyNewAlerts() {
  const current = new Map();
  for (const { device, alerts } of alertsByDevice(data.json)) for (const a of alerts) current.set(`${device.device_id}|${a.id}`, { device, a });
  if (seenAlerts && store.get('notify') && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    for (const [key, { device, a }] of current) {
      if (!seenAlerts.has(key)) {
        try { new Notification(`${deviceTitle(device)}: ${t(a.level === 'fault' ? 'faultBadge' : 'warningBadge')}`, { body: a.text, tag: key }); } catch { /* ignored */ }
      }
    }
  }
  seenAlerts = new Set(current.keys());
}

async function refresh() {
  if (!sessionValid() || data.loading) return;
  loadLimits(render);
  data.loading = true;
  try {
    data.json = await getMyDevices();
    data.error = null;
    notifyNewAlerts();
  } catch (e) {
    if (e.status !== 401) data.error = errorText(e);
  } finally {
    data.loading = false;
  }
  render();
  startPolling();
}

function startPolling() {
  if (timer || !sessionValid()) return;
  timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
}
function stopPolling() { clearInterval(timer); timer = null; }

onSessionEnd((reason) => {
  data.json = null;
  forgetSettings();
  forgetLimits();
  loginNotice = reason === 'expired' ? t('sessionExpired') : '';
  location.hash = '#/login';
  render();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('hashchange', render);
// Charts are drawn at pixel width, so redraw them when the width changes (rotation, window resize).
let lastWidth = window.innerWidth;
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.innerWidth === lastWidth) return; // mobile URL bar changes only the height
    lastWidth = window.innerWidth;
    if (parseRoute().sub === 'history') render();
  }, 200);
});

if (getSession() && !sessionValid()) loginNotice = t('sessionExpired');
render();
refresh();
