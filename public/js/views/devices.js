import { h } from '../dom.js';
import { t } from '../i18n.js';
import { elapsed } from '../fmt.js';
import { telemetry, deviceRow, deviceTitle, deviceImage } from '../regs.js';
import { activeAlerts, faultsOf, warningsOf } from '../alerts.js';

export function deviceSummary(json, d) {
  const found = deviceRow(json, d.device_id);
  return found && found.list === 'mas_powerstation' ? telemetry(found.row) : null;
}

export function devicesView(root, { data }) {
  const devices = data.json?.devices || [];
  if (!devices.length) {
    root.replaceChildren(
      h('div', { class: 'empty card' },
        h('img', { src: 'assets/img/powerstation_flache.webp', alt: '', class: 'empty-img' }),
        h('h2', {}, t('noDevices')),
        h('p', { class: 'muted' }, t('noDevicesHint')),
      ),
    );
    return;
  }

  root.replaceChildren(
    h('h1', { class: 'page-title' }, t('devices')),
    h('div', { class: 'device-list' }, devices.map((d) => {
      const m = deviceSummary(data.json, d);
      const alerts = m ? activeAlerts(m) : [];
      const status = !m?.time ? t('noData') : m.online ? t('online') : t('offlineFor', { t: elapsed(m.time) });
      return h('a', { class: 'device-card card' + (m?.online ? '' : ' offline'), href: `#/device/${encodeURIComponent(d.device_id)}` },
        h('img', { src: deviceImage(d), alt: '', class: 'device-thumb' }),
        h('div', { class: 'device-info' },
          h('div', { class: 'device-name' }, deviceTitle(d)),
          h('div', { class: 'device-status' }, h('span', { class: 'dot' + (m?.online ? ' ok' : '') }), status),
          m && h('div', { class: 'chips' },
            m.mode && h('span', { class: 'chip' + (m.fault ? ' bad' : '') }, m.mode),
            faultsOf(alerts).length > 0 && h('span', { class: 'chip bad' }, t('faultsCount', { n: faultsOf(alerts).length })),
            warningsOf(alerts).length > 0 && h('span', { class: 'chip warn' }, t('warningsCount', { n: warningsOf(alerts).length })),
          ),
        ),
        m?.soc != null && h('div', { class: 'device-soc' }, Math.round(m.soc), h('small', {}, '%')),
      );
    })),
  );
}
