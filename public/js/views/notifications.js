import { h } from '../dom.js';
import { t } from '../i18n.js';
import { datetime, elapsed } from '../fmt.js';
import { deviceTitle } from '../regs.js';
import { alertsByDevice } from '../alerts.js';
import { FAULTS, WARNINGS } from '../alerts-text.js';
import { logFor } from '../alertlog.js';

// Text of one logged bit, same wording as the live list.
function eventText(e) {
  const name = (e.type === 'fault' ? FAULTS : WARNINGS)[e.bit];
  return name ? t(e.type + name) : t('unknownError');
}

function logRow(e) {
  const since = datetime(e.from * 1000);
  const span = e.to == null ? t('alertOngoing') : t('alertUntil', { t: datetime(e.to * 1000) });
  const length = e.to == null ? '' : elapsed(Date.now() - (e.to - e.from) * 1000);
  return h('li', { class: 'log-row ' + e.type },
    h('span', { class: 'log-kind' }, t(e.type === 'fault' ? 'faultBadge' : 'warningBadge')),
    h('div', { class: 'log-main' }, h('div', { class: 'log-text' }, eventText(e)),
      h('div', { class: 'muted small' }, `${t('alertSince', { t: since })} · ${span}${length ? ' · ' + length : ''}`)));
}

export function notificationsView(root, { data, rerender }) {
  const items = alertsByDevice(data.json);
  const active = items.filter((i) => i.alerts.length);

  const nowBlock = active.length
    ? active.map(({ device, m, alerts }) => h('section', { class: 'card pad notif-card' },
      h('div', { class: 'notif-head' },
        h('a', { href: `#/device/${encodeURIComponent(device.device_id)}`, class: 'notif-device' }, deviceTitle(device)),
        m?.time && h('span', { class: 'muted small' }, datetime(m.time))),
      h('ul', { class: 'alert-list' }, alerts.map((a) => h('li', { class: 'alert ' + a.level + (a.high ? ' high' : '') },
        h('strong', {}, t(a.level === 'fault' ? 'faultBadge' : 'warningBadge')), h('span', {}, a.text))))))
    : [h('div', { class: 'card pad all-clear' }, h('span', { class: 'dot ok' }), t('noActiveNotificationsAllDevices'))];

  const logs = items.filter((i) => i.m).map(({ device }) => {
    const events = logFor(device.device_id, rerender);
    return h('section', { class: 'card pad' },
      h('h3', { class: 'section-title' }, `${t('alertsLogTitle')} · ${deviceTitle(device)}`),
      events == null ? h('p', { class: 'muted small' }, t('loading'))
        : events.length ? h('ul', { class: 'log-list' }, events.map(logRow))
          : h('p', { class: 'muted' }, t('alertsLogEmpty')));
  });

  root.replaceChildren(
    h('h1', { class: 'page-title' }, t('notifications')),
    h('h2', { class: 'section-h' }, t('alertsNow')),
    ...nowBlock,
    h('p', { class: 'muted small' }, t('alertsLogNote')),
    ...logs,
  );
}
