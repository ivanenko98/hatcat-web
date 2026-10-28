import { h } from '../dom.js';
import { t } from '../i18n.js';
import { deviceTitle } from '../regs.js';

export const DEVICE_TABS = [
  { sub: '', key: 'overview' },
  { sub: 'history', key: 'history' },
  { sub: 'settings', key: 'settings' },
];

// Title with back link and the tab strip shared by every device screen.
export function deviceHead(d, active) {
  const base = `#/device/${encodeURIComponent(d.device_id)}`;
  return [
    h('div', { class: 'page-head' },
      h('a', { class: 'btn ghost back', href: '#/devices', 'aria-label': t('back') }, '←'),
      h('h1', { class: 'page-title' }, deviceTitle(d)),
    ),
    h('nav', { class: 'tabs', 'aria-label': deviceTitle(d) }, DEVICE_TABS.map((tab) =>
      h('a', { href: tab.sub ? `${base}/${tab.sub}` : base, class: tab.sub === active ? 'on' : '', 'aria-current': tab.sub === active ? 'page' : null }, t(tab.key)))),
  ];
}
